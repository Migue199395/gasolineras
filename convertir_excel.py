#!/usr/bin/env python3
"""
Convierte gasolineras.xlsx a gasolineras.json sin dependencias externas.

- Lee archivos XLSX usando únicamente la biblioteca estándar de Python.
- Recorre todas las hojas.
- Detecta automáticamente la fila de encabezados.
- Reconoce columnas comunes aunque cambie el orden o algunas no existan.
- Conserva campos adicionales dentro de "extras".
- Si la marca no viene como columna, intenta inferirla del nombre de la hoja
  (por ejemplo, hojas "ESTACIONES SHELL" y "ESTACIONES UNO").
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from posixpath import normpath, join as posix_join

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_DOCREL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

ALIASES = {
    "nombre": {
        "NOMBRE", "NOMBRE GASOLINERA", "NOMBRE DE GASOLINERA",
        "GASOLINERA", "NOMBRE ESTACION", "NOMBRE DE ESTACION"
    },
    "estacion": {"ESTACION"},
    "marca": {"MARCA", "BRAND"},
    "direccion": {"DIRECCION", "DIRECCION EXACTA", "DOMICILIO", "UBICACION"},
    "municipio": {"MUNICIPIO", "MUNICIPALIDAD"},
    "departamento": {"DEPARTAMENTO", "DEPTO"},
    "latitud": {"LATITUD", "LATITUDE", "LAT"},
    "longitud": {"LONGITUD", "LONGITUDE", "LON", "LNG", "LONG"},
    "fuente_ubicacion": {"FUENTE UBICACION"},
    "fecha_ubicacion": {"FECHA UBICACION"},
    "nombre_ubicacion": {"NOMBRE UBICACION"},
    "codigo": {"CODIGO", "ID", "IDENTIFICADOR", "CODIGO ESTACION"},
    "grupo": {"GRUPO", "GROUP"},
    "categoria": {"CATEGORIA", "CATEGORY"},
    "observaciones": {"OBSERVACIONES", "OBSERVACION", "NOTAS", "NOTA", "COMENTARIOS"},
    "numero": {"NO", "NUMERO", "NRO", "NUM"},
    "espacio": {"ESPACIO"},
}

CORE_FIELDS = {
    "nombre", "estacion", "marca", "direccion", "municipio", "departamento",
    "latitud", "longitud", "codigo", "grupo", "categoria", "observaciones"
}

def norm_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)

def norm_header(value) -> str:
    text = norm_text(value)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.upper()
    text = re.sub(r"[^A-Z0-9]+", " ", text).strip()
    return text

def canonical_header(value):
    h = norm_header(value)
    for canonical, aliases in ALIASES.items():
        if h in aliases:
            return canonical
    return None

def excel_col_index(ref: str) -> int:
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def read_shared_strings(zf: zipfile.ZipFile):
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values = []
    for si in root.findall(f"{{{NS_MAIN}}}si"):
        parts = []
        for t in si.iter(f"{{{NS_MAIN}}}t"):
            parts.append(t.text or "")
        values.append("".join(parts))
    return values

def relationship_map(zf: zipfile.ZipFile):
    rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rels = {}
    for rel in rel_root.findall(f"{{{NS_REL}}}Relationship"):
        rels[rel.attrib["Id"]] = rel.attrib["Target"]
    return rels

def workbook_sheets(zf: zipfile.ZipFile):
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = relationship_map(zf)
    sheets = []
    for sh in workbook.findall(f".//{{{NS_MAIN}}}sheet"):
        name = sh.attrib.get("name", "")
        rid = sh.attrib.get(f"{{{NS_DOCREL}}}id")
        target = rels.get(rid, "")
        if target.startswith("/"):
            path = target.lstrip("/")
        else:
            path = normpath(posix_join("xl", target))
        sheets.append((name, path))
    return sheets

def cell_value(cell, shared_strings):
    ctype = cell.attrib.get("t", "")
    if ctype == "inlineStr":
        parts = [t.text or "" for t in cell.iter(f"{{{NS_MAIN}}}t")]
        return "".join(parts)

    v = cell.find(f"{{{NS_MAIN}}}v")
    if v is None or v.text is None:
        return None
    raw = v.text

    if ctype == "s":
        try:
            return shared_strings[int(raw)]
        except Exception:
            return raw
    if ctype == "str":
        return raw
    if ctype == "b":
        return raw == "1"

    try:
        num = float(raw)
        if math.isfinite(num) and num.is_integer():
            return int(num)
        return num
    except ValueError:
        return raw

def read_sheet_rows(zf, sheet_path, shared_strings):
    root = ET.fromstring(zf.read(sheet_path))
    rows = []
    for row_node in root.findall(f".//{{{NS_MAIN}}}row"):
        # Preserve the workbook's actual row numbers, including omitted blank rows.
        row_number = int(row_node.attrib.get("r", len(rows) + 1))
        while len(rows) < row_number - 1:
            rows.append([])
        cells = {}
        max_col = -1
        for cell in row_node.findall(f"{{{NS_MAIN}}}c"):
            ref = cell.attrib.get("r", "")
            if not ref:
                continue
            idx = excel_col_index(ref)
            cells[idx] = cell_value(cell, shared_strings)
            max_col = max(max_col, idx)
        if max_col < 0:
            rows.append([])
        else:
            rows.append([cells.get(i) for i in range(max_col + 1)])
    return rows

def find_header_row(rows):
    best_idx = None
    best_score = -1
    for idx, row in enumerate(rows[:50]):
        canon = [canonical_header(v) for v in row]
        found = {x for x in canon if x}
        score = len(found)
        # Strongly prefer rows that look like the actual location table.
        if "nombre" in found:
            score += 3
        if "direccion" in found:
            score += 3
        if "municipio" in found:
            score += 2
        if "departamento" in found:
            score += 2
        if score > best_score:
            best_score = score
            best_idx = idx
    if best_idx is None or best_score < 4:
        return None
    return best_idx

def value_at(row, idx):
    return row[idx] if idx is not None and idx < len(row) else None

def clean_scalar(value):
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return value
    s = norm_text(value)
    return s or None

def parse_float(value):
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace(",", "."))
        if math.isfinite(number):
            return number
    except Exception:
        pass
    return None

def infer_brand(sheet_name: str):
    s = norm_header(sheet_name)
    if "SHELL" in s:
        return "Shell"
    if re.search(r"\bUNO\b", s):
        return "UNO"
    return None

def slug(value):
    s = norm_header(value).lower().replace(" ", "-")
    return s or "registro"

def convert(input_path: Path, output_path: Path):
    records = []
    with zipfile.ZipFile(input_path) as zf:
        shared = read_shared_strings(zf)
        for sheet_name, sheet_path in workbook_sheets(zf):
            rows = read_sheet_rows(zf, sheet_path, shared)
            header_idx = find_header_row(rows)
            if header_idx is None:
                continue

            headers = rows[header_idx]
            canonical_by_col = {}
            raw_header_by_col = {}
            used_canonical = set()

            for col, h in enumerate(headers):
                raw = norm_text(h)
                if not raw:
                    continue
                raw_header_by_col[col] = raw
                canonical = canonical_header(h)
                # Preserve duplicate semantic columns as extras instead of overwriting.
                if canonical and canonical not in used_canonical:
                    canonical_by_col[col] = canonical
                    used_canonical.add(canonical)

            inferred_brand = infer_brand(sheet_name)

            for sheet_row_num, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
                mapped = {}
                extras = {}
                for col, raw_header in raw_header_by_col.items():
                    val = clean_scalar(value_at(row, col))
                    if val is None:
                        continue
                    canonical = canonical_by_col.get(col)
                    if canonical:
                        mapped[canonical] = val
                    else:
                        extras[raw_header] = val

                # Ignore fully empty/footer rows.
                if not mapped and not extras:
                    continue

                # Ignore accidental repeated header rows.
                if norm_header(mapped.get("nombre")) == "NOMBRE" and norm_header(mapped.get("direccion")) == "DIRECCION":
                    continue

                nombre = clean_scalar(mapped.get("nombre")) or clean_scalar(mapped.get("estacion"))
                marca = clean_scalar(mapped.get("marca")) or inferred_brand
                direccion = clean_scalar(mapped.get("direccion"))
                municipio = clean_scalar(mapped.get("municipio"))
                departamento = clean_scalar(mapped.get("departamento"))
                latitud = parse_float(mapped.get("latitud"))
                longitud = parse_float(mapped.get("longitud"))
                codigo = clean_scalar(mapped.get("codigo"))
                grupo = clean_scalar(mapped.get("grupo")) or clean_scalar(mapped.get("categoria"))
                observaciones = clean_scalar(mapped.get("observaciones"))

                if not any([nombre, marca, direccion, municipio, departamento, latitud is not None, longitud is not None]):
                    continue

                # Keep a secondary ESTACION column as extra if NOMBRE already supplied.
                if mapped.get("estacion") and mapped.get("nombre"):
                    extras.setdefault("ESTACIÓN", clean_scalar(mapped.get("estacion")))

                rec = {
                    "id": f"{slug(sheet_name)}-{sheet_row_num - header_idx}",
                    "nombre": nombre,
                    "marca": marca,
                    "direccion": direccion,
                    "municipio": municipio,
                    "departamento": departamento,
                    "latitud": latitud,
                    "longitud": longitud,
                    "fuente_ubicacion": clean_scalar(mapped.get("fuente_ubicacion")),
                    "fecha_ubicacion": clean_scalar(mapped.get("fecha_ubicacion")),
                    "nombre_ubicacion": clean_scalar(mapped.get("nombre_ubicacion")),
                    "codigo": codigo,
                    "grupo": grupo,
                    "observaciones": observaciones,
                    "extras": extras or None,
                    "_origen": {"hoja": sheet_name, "fila": sheet_row_num},
                }
                records.append(rec)

    output_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    with_coords = sum(
        1 for r in records
        if isinstance(r.get("latitud"), (int, float)) and isinstance(r.get("longitud"), (int, float))
    )
    with_address = sum(1 for r in records if r.get("direccion"))
    print(f"Convertidas: {len(records)} gasolineras")
    print(f"Con coordenadas: {with_coords}")
    print(f"Con dirección: {with_address}")
    print(f"Archivo generado: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Convierte el Excel de gasolineras a JSON.")
    parser.add_argument("excel", nargs="?", default="gasolineras.xlsx", help="Archivo XLSX de entrada")
    parser.add_argument("json", nargs="?", default="gasolineras.json", help="Archivo JSON de salida")
    args = parser.parse_args()
    convert(Path(args.excel), Path(args.json))

if __name__ == "__main__":
    main()
