const PREFIX_MAP: Record<string, string> = {
  chk: 'cs_',
  pi: 'pi_',
  pm: 'pm_',
  sub: 'sub_',
  cus: 'cus_',
  inv: 'in_',
  ref: 'ref_',
};

export function toProviderId(prefix: string, id: string): string {
  if (!id) return id;
  const mapped = PREFIX_MAP[prefix];
  if (mapped && id.startsWith(`${prefix}_`)) {
    return id.replace(`${prefix}_`, mapped);
  }
  return id;
}

export function toPublicId(prefix: string, id: string): string {
  if (!id) return id;
  const mapped = PREFIX_MAP[prefix];
  if (mapped && id.startsWith(mapped)) {
    return id.replace(mapped, `${prefix}_`);
  }
  if (!id.startsWith(`${prefix}_`)) {
    return `${prefix}_${id}`;
  }
  return id;
}
