// Builds a consistent display name from first/middle/last + suffix.
// Maiden name is intentionally NOT included here — it's shown separately
// (e.g. in the side panel) rather than folded into every name display.
export function formatFullName(data = {}) {
  const parts = [data["first name"], data["middle name"], data["last name"]].filter(Boolean);
  let name = parts.join(" ");
  if (data.suffix) name += ` ${data.suffix}`;
  return name.trim();
}
