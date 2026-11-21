# Fast CSV reader

A faster drop-in for make.fun's own csv-reader 1.0.0, for the
"Read broken CSV files faster, 21 November 2026" bounty
(`csv-reader-speed-01-run-20261121`).

`run(input)` in `solve.js` returns exactly what csv-reader returns for
`{text, header}` — `{columns, rows, errors}` — under its written broken-row
policy (BOM dropped, records end at LF or CRLF, stray CRs dropped, quoted
fields with doubled quotes and CR/LF normalised to LF, quote junk and
unterminated quotes recorded, rows padded or cut to the first record's width).

## Approach

csv-reader reads one character at a time, building each field up a character
at a time. This reader makes one pass of index-based scans instead: each
field is scanned by char code until its terminator, then taken as a single
slice of the text. Pieces are joined only when a field actually needs more
than one — a stray CR dropped mid-field, a doubled quote, or a CR inside
quotes. Quoted fields with no escapes or line breaks cost one slice, and
unquoted fields the same. Nothing is cached from one case to the next, and
the run is deterministic: two runs write byte-identical answers.

`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`. It turns V8's incremental marking off before
importing `solve.js`, as the house baseline does.
