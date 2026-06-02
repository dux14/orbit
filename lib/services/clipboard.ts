export async function copyWithAutoClear(value: string, delayMs = 20000): Promise<void> {
  await navigator.clipboard.writeText(value);
  setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === value) await navigator.clipboard.writeText('');
    } catch {
      // readText may be blocked; best-effort clear
    }
  }, delayMs);
}
