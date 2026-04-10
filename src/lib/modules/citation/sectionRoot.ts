export function splitSectionPath(sectionPath: string | null | undefined): string[] {
  return (sectionPath ?? "")
    .split(">")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function extractSectionRootLabel(sectionPath: string | null | undefined): string | null {
  const segments = splitSectionPath(sectionPath);
  const numericTwoLevel = segments.find((segment) => /^\d+\.\d+\s*/.test(segment));
  if (numericTwoLevel) {
    return numericTwoLevel;
  }

  if (segments.length >= 2) {
    return segments.slice(0, 2).join(" > ");
  }

  return segments[0] ?? null;
}
