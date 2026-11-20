/**
 * CSV for spreadsheet export (opens in Excel, Numbers and Google Sheets).
 * - Values are quoted when needed (RFC 4180).
 * - Text starting with = + - @ (or tab / carriage return) is prefixed with an
 *   apostrophe so a spreadsheet never runs it as a formula (CSV injection).
 *   Numbers are written as numbers and are never prefixed.
 * - A UTF-8 byte order mark makes Excel read names with accents correctly.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
