/** Comprueba que la URL devuelve realmente un GLB (el servidor de Vite devuelve index.html con 200 si no existe). */
export async function glbExists(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return false;
    const reader = res.body?.getReader();
    if (!reader) return false;
    const { value } = await reader.read();
    ctrl.abort();
    return !!value && value.length >= 4 && value[0] === 0x67 && value[1] === 0x6c && value[2] === 0x54 && value[3] === 0x46; // "glTF"
  } catch {
    return false;
  }
}

