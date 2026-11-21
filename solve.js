// A fast drop-in for csv-reader 1.0.0, make.fun's own CSV reader: run(input) returns
// exactly what csv-reader returns for {text, header} — {columns, rows, errors} — but
// reads the text in one pass of index-based scans, building each field from slices
// instead of one character at a time, so a long plain field costs a single slice.
//
// The reading policy is csv-reader's own (the competition's RULES.txt): a U+FEFF at the
// very start is dropped; a record ends at LF or CRLF and an empty line is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a field that opens with
// a quote runs to the next quote that is not doubled ("" inside it is one quote, each
// CRLF or lone CR inside it is read as LF); what follows its closing quote, up to the
// next comma or line break, is appended as it stands (quote_junk, when the field ends);
// a quote that never closes is a literal character and the text after it is read again
// as unquoted (unterminated_quote); a quote inside an unquoted field is a literal
// character; fields stay strings, never trimmed or converted; columns is the first
// record when header is true, else null; rows holds the records after it, each padded
// with "" (short_row, with fields: its count) or cut (long_row, with extra: the cut
// fields) to the first record's width; each error is {code, line, row} in the order met,
// line the 1-based line its record starts on, row its record's index in rows (null for
// the header). Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  let ended = END; // how the field just read ended
  let added = 0; // the characters the unquoted read just kept
  let recordLine = 1; // the line the record being read starts on
  let recordRow = null; // its index in rows (null for the header)

  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, onto `initial` ('' for a fresh field, the
  // quoted value for quote junk, '"' for a quote that never closes). Returns the field
  // and sets `ended` and `added` (the characters it kept). A CR not followed by LF is
  // dropped (stray_cr) and the field goes on; the field's kept pieces are slices of the
  // text, joined only when a stray CR forced more than one.
  function readUnquoted(initial) {
    let value = initial;
    let parts = null;
    let seg = pos;
    added = 0;
    let c = 0;
    while (pos < len) {
      c = text.charCodeAt(pos);
      if (c === 44 || c === 10) break; // comma or LF: the field ends here
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) break; // CRLF: the field ends here
        pushError('stray_cr');
        added += pos - seg;
        if (parts === null) parts = [value];
        parts.push(text.slice(seg, pos));
        pos += 1;
        seg = pos;
        continue;
      }
      pos += 1;
    }
    if (pos >= len) ended = END;
    else if (c === 44) ended = COMMA;
    else ended = BREAK;
    added += pos - seg;
    let out;
    if (parts === null) out = value + text.slice(seg, pos);
    else {
      parts.push(text.slice(seg, pos));
      out = parts.join('');
    }
    if (ended === COMMA) pos += 1;
    else if (ended === BREAK) {
      if (c === 13) pos += 2;
      else pos += 1;
      line += 1;
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field and sets
  // `ended` (and `added`, through the unquoted read, for quote junk). A doubled quote
  // inside it is one quote; each CRLF or lone CR inside it is read as LF; what follows
  // its closing quote, up to the next comma or line break, is appended as it stands.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1; // the opening quote
    let parts = null;
    let seg = pos;
    let closed = false;
    let c = 0;
    while (pos < len) {
      c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, pos), '"');
          pos += 2;
          seg = pos;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        if (parts === null) parts = [];
        parts.push(text.slice(seg, pos), '\n');
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        seg = pos;
        continue;
      }
      if (c === 10) line += 1; // LF inside quotes is kept as it stands
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      return readUnquoted('"');
    }
    const endContent = pos - 1; // the closing quote
    let value;
    if (parts === null) value = text.slice(seg, endContent);
    else {
      parts.push(text.slice(seg, endContent));
      value = parts.join('');
    }
    if (pos >= len) {
      ended = END;
      return value;
    }
    c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      ended = BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = BREAK;
      return value;
    }
    const junk = readUnquoted(value);
    if (added > 0) pushError('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
