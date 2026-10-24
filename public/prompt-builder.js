const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');

export function buildVideoPrompt({subject, action, setting, camera, lighting, style, pace, details} = {}) {
  const who = clean(subject);
  const doing = clean(action);
  if (!who || !doing) return '';
  const parts = [`${who.replace(/[.!?]+$/, '')} ${doing.replace(/[.!?]+$/, '')}`];
  if (clean(setting)) parts.push(`The scene takes place ${clean(setting).replace(/[.!?]+$/, '')}`);
  for (const value of [camera, lighting, style, pace, details]) if (clean(value)) parts.push(clean(value));
  return parts.map(p => /[.!?]$/.test(p) ? p : `${p}.`).join(' ').slice(0, 3000);
}
