/** Trim, strip invisible chars, extract plan_… from pasted dashboard URLs. */
export function sanitizeRazorpayPlanId(raw: string): string {
  let s = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  const embedded = s.match(/\b(plan_[A-Za-z0-9]+)\b/);
  if (
    embedded &&
    (s.includes('razorpay.com') || s.toLowerCase().includes('http'))
  ) {
    return embedded[1];
  }
  return s;
}
