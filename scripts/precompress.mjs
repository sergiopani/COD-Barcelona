// Pre-comprime (Brotli + gzip) los archivos de texto del build para que el servidor los entregue sin comprimir al vuelo.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dir = path.resolve(process.argv[2] ?? "dist");
const EXT = new Set([".js", ".css", ".html", ".json", ".svg", ".txt", ".mjs"]);
let files = 0;
let before = 0;
let after = 0;

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.has(path.extname(e.name)) && !e.name.endsWith(".br") && !e.name.endsWith(".gz")) {
      const buf = fs.readFileSync(p);
      if (buf.length < 1024) continue;
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
      fs.writeFileSync(p + ".br", br);
      fs.writeFileSync(p + ".gz", zlib.gzipSync(buf, { level: 9 }));
      files++;
      before += buf.length;
      after += br.length;
    }
  }
}
walk(dir);
console.log(`precompress: ${files} archivos, ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB (Brotli)`);
