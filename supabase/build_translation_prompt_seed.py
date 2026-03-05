from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parent.parent
QUESTION_BANK = ROOT / "四级题库"
OUTPUT_SQL = Path(__file__).resolve().parent / "translation_prompts_seed.sql"
OUTPUT_JSON = Path(__file__).resolve().parent / "translation_prompts_seed.json"
PDFTOTEXT = Path(r"D:\latex\texlive\2024\bin\windows\pdftotext.exe")


def normalize_width(text: str) -> str:
  chars: List[str] = []
  for ch in text:
    code = ord(ch)
    if code == 0x3000:
      chars.append(" ")
    elif 0xFF01 <= code <= 0xFF5E:
      chars.append(chr(code - 0xFEE0))
    else:
      chars.append(ch)
  out = "".join(chars)
  return (
    out.replace("Ⅳ", "IV")
    .replace("Ⅱ", "II")
    .replace("Ⅰ", "I")
    .replace("“", "\"")
    .replace("”", "\"")
    .replace("’", "'")
    .replace("‘", "'")
  )


def run_pdftotext(path: Path) -> str:
  cmd = [str(PDFTOTEXT), "-layout", "-enc", "UTF-8", str(path), "-"]
  proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
  if proc.returncode != 0:
    raise RuntimeError(f"pdftotext failed: {path}\n{proc.stderr}")
  return proc.stdout


def contains_chinese(text: str) -> bool:
  return re.search(r"[\u4e00-\u9fff]", text) is not None


def parse_year_month(path: Path) -> Optional[Tuple[int, int]]:
  text = str(path)
  matched = re.search(r"(20\d{2})[.\-年](\d{1,2})", text)
  if not matched:
    return None
  year = int(matched.group(1))
  month = int(matched.group(2))
  if not (1 <= month <= 12):
    return None
  return year, month


def parse_set_no(path: Path) -> Optional[int]:
  text = normalize_width(path.name)
  matched = re.search(r"第\s*([0-9一二三])\s*套", text)
  if not matched:
    matched = re.search(r"【\s*第?\s*([0-9一二三])\s*套\s*】", text)
  if not matched:
    return None
  token = matched.group(1)
  mapping = {"一": 1, "二": 2, "三": 3}
  if token in mapping:
    return mapping[token]
  try:
    number = int(token)
  except ValueError:
    return None
  return number if number > 0 else None


def clean_source_text(text: str) -> str:
  text = normalize_width(text)
  text = text.replace("\u000c", "\n")
  lines = [line.rstrip() for line in text.splitlines()]

  start = -1
  for i, line in enumerate(lines):
    if re.search(r"Part\s*IV", line, flags=re.IGNORECASE) and re.search(r"Translation", line, flags=re.IGNORECASE):
      start = i
      break
  if start < 0:
    return ""

  collected: List[str] = []
  seen_chinese = False
  blank_run = 0
  for raw in lines[start + 1 :]:
    line = raw.strip()
    if not line:
      blank_run += 1
      if seen_chinese and blank_run >= 3:
        break
      continue
    blank_run = 0

    if line.startswith("Directions:") or line.startswith("DIRECTONS:"):
      continue
    if re.search(r"^第\s*\d+\s*页", line):
      if seen_chinese:
        break
      continue
    if re.search(r"^20\d{2}年.*第\d+页", line):
      if seen_chinese:
        break
      continue
    if "公众号" in line:
      continue
    if line.startswith("Part ") and seen_chinese:
      break
    if re.match(r"^\d+\.", line) and seen_chinese:
      break

    if not seen_chinese and contains_chinese(line):
      seen_chinese = True

    if not seen_chinese:
      continue

    # Once translation text starts, stop when non-Chinese exam content starts.
    if not contains_chinese(line):
      alpha_count = len(re.findall(r"[A-Za-z]", line))
      if alpha_count >= 12:
        break

    collected.append(line)

  source = "".join(collected)
  source = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", source)
  source = re.sub(r"\s+([，。；：！？）])", r"\1", source)
  source = re.sub(r"([（])\s+", r"\1", source)
  source = re.sub(r"\s+", " ", source).strip()
  source = normalize_noise(source)
  return source


def clean_reference_text(text: str) -> str:
  text = normalize_width(text).replace("\u000c", "\n")
  lines = [line.strip() for line in text.splitlines()]
  marks = [i for i, line in enumerate(lines) if "参考译文" in line]
  if not marks:
    return ""
  start = marks[-1] + 1

  collected: List[str] = []
  for line in lines[start:]:
    if not line:
      if collected:
        break
      continue
    if "译点精析" in line or "答案详解" in line or "公众号" in line:
      break
    if re.match(r"^\d+\.", line):
      break
    if contains_chinese(line) and len(re.findall(r"[A-Za-z]", line)) < 8:
      if collected:
        break
      continue
    if re.search(r"[A-Za-z]", line):
      collected.append(line)

  if not collected:
    return ""
  reference = " ".join(collected)
  reference = re.sub(r"\s+", " ", reference).strip()
  reference = normalize_noise(reference)
  return reference


def normalize_noise(text: str) -> str:
  # Fix common extraction artifacts: doubled question marks, split numbers and spaced English words.
  text = text.replace("??", "%")
  text = re.sub(r"(?<=\d)\s+(?=\d)", "", text)
  text = re.sub(r"\s+%", "%", text)
  text = re.sub(r"(\d+(?:\.\d+)?)of\b", r"\1% of", text, flags=re.IGNORECASE)
  text = re.sub(r"%\s+of", "% of", text, flags=re.IGNORECASE)
  text = re.sub(r"\(\s+", "(", text)
  text = re.sub(r"\s+\)", ")", text)
  text = re.sub(r"%\s+,", "%,", text)
  text = re.sub(r'"\s+(\d+分钟)', r'"\1', text)

  def merge_letters(match: re.Match[str]) -> str:
    return match.group(0).replace(" ", "")

  text = re.sub(r"\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b", merge_letters, text)
  text = re.sub(r"\s+", " ", text).strip()
  return text


def is_source_pdf(path: Path) -> bool:
  full = str(path)
  name = path.name
  if "扫描版" in full:
    return False
  if "仅看译文" in name:
    return False
  if "解析" in name or "详解" in name:
    return False
  return ("真题" in name) or ("原题" in full)


def is_analysis_pdf(path: Path) -> bool:
  name = path.name
  return ("解析" in name) or ("详解" in name)


def build_title(source: str) -> str:
  if not source:
    return "四级翻译真题"
  first = re.split(r"[，。；：]", source, maxsplit=1)[0]
  first = re.sub(r"[“”\"'（）()]", "", first).strip()
  if len(first) <= 18:
    return first
  return f"{first[:18]}..."


def sql_quote(value: str) -> str:
  return "'" + value.replace("'", "''") + "'"


def main() -> None:
  if not PDFTOTEXT.exists():
    raise FileNotFoundError(f"pdftotext not found: {PDFTOTEXT}")
  if not QUESTION_BANK.exists():
    raise FileNotFoundError(f"question bank folder not found: {QUESTION_BANK}")

  source_by_key: Dict[Tuple[int, int, int], Dict[str, str]] = {}
  refs_by_key: Dict[Tuple[int, int, int], str] = {}
  warnings: List[str] = []

  all_pdfs = sorted(QUESTION_BANK.rglob("*.pdf"))
  for pdf in all_pdfs:
    ym = parse_year_month(pdf)
    set_no = parse_set_no(pdf)
    if not ym or not set_no:
      continue
    key = (ym[0], ym[1], set_no)

    try:
      txt = run_pdftotext(pdf)
    except Exception as exc:
      warnings.append(f"[WARN] read failed: {pdf} -> {exc}")
      continue

    if is_source_pdf(pdf):
      source = clean_source_text(txt)
      if source:
        source_by_key[key] = {
          "source": source,
          "source_file": str(pdf.relative_to(ROOT)),
        }
      else:
        warnings.append(f"[WARN] source not found: {pdf}")

    if is_analysis_pdf(pdf):
      ref = clean_reference_text(txt)
      if ref:
        refs_by_key[key] = ref

  records: List[Dict[str, str]] = []
  for key in sorted(source_by_key.keys(), reverse=True):
    year, month, set_no = key
    source = source_by_key[key]["source"]
    ref = refs_by_key.get(key, "")
    paper_code = f"{year}-{month:02d}-S{set_no}"
    records.append(
      {
        "year": year,
        "paper_code": paper_code,
        "prompt_no": 1,
        "title": build_title(source),
        "source_text": source,
        "reference_text": ref,
        "tags": ["cet4", f"{year}-{month:02d}", f"set{set_no}"],
        "difficulty": "normal",
        "source_file": source_by_key[key]["source_file"],
        "has_reference": "1" if ref else "0",
      }
    )

  if not records:
    raise RuntimeError("no records extracted")

  rows_sql: List[str] = []
  for row in records:
    tags_sql = "array[" + ", ".join(sql_quote(tag) for tag in row["tags"]) + "]"
    rows_sql.append(
      "  (\n"
      f"    {row['year']},\n"
      f"    {sql_quote(row['paper_code'])},\n"
      "    1,\n"
      f"    {sql_quote(row['title'])},\n"
      f"    {sql_quote(row['source_text'])},\n"
      f"    {sql_quote(row['reference_text'])},\n"
      f"    {tags_sql},\n"
      f"    {sql_quote(row['difficulty'])}\n"
      "  )"
    )

  sql = (
    "insert into public.translation_prompts (\n"
    "  year, paper_code, prompt_no, title, source_text, reference_text, tags, difficulty\n"
    ")\n"
    "values\n"
    + ",\n".join(rows_sql)
    + "\n"
    "on conflict (year, paper_code, prompt_no) do update\n"
    "set\n"
    "  title = excluded.title,\n"
    "  source_text = excluded.source_text,\n"
    "  reference_text = excluded.reference_text,\n"
    "  tags = excluded.tags,\n"
    "  difficulty = excluded.difficulty;\n"
  )
  OUTPUT_SQL.write_text(sql, encoding="utf-8")
  OUTPUT_JSON.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

  print(f"records: {len(records)}")
  ref_count = sum(1 for item in records if item["has_reference"] == "1")
  print(f"with reference: {ref_count}")
  print(f"sql: {OUTPUT_SQL}")
  print(f"json: {OUTPUT_JSON}")
  if warnings:
    print("warnings:")
    for line in warnings:
      print(line)


if __name__ == "__main__":
  main()
