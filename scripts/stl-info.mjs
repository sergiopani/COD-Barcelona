// Lee STL binarios (solo lectura de datos) e imprime triángulos y caja envolvente. Uso: node scripts/stl-info.mjs <archivos...>
import fs from "node:fs";
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  const n = b.readUInt32LE(80);
  const bin = 84 + n * 50 === b.length;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  if (bin) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
        const x = b.readFloatLE(o + v * 12 + k * 4);
        if (x < mn[k]) mn[k] = x;
        if (x > mx[k]) mx[k] = x;
      }
    }
  }
  console.log(f.split("/").pop(), "binario:", bin, "tris:", n, "min:", mn.map((v) => v.toFixed(1)).join(","), "max:", mx.map((v) => v.toFixed(1)).join(","), "tam:", mx.map((v, i) => (v - mn[i]).toFixed(1)).join(" x "));
}
