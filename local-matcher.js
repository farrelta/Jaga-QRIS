// Tiny local text matcher for merchant identity evidence.
// Character n-gram cosine similarity is useful for spacing, punctuation, and
// small spelling differences. It is a similarity model, not a calibrated
// probability and must not be presented as a fraud score.
(function () {
  "use strict";

  function normalize(value = "") {
    return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function vectorize(value) {
    const text = ` ${normalize(value)} `;
    const vector = new Map();
    if (text.trim().length < 2) return vector;
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= text.length - size; index += 1) {
        const gram = text.slice(index, index + size);
        vector.set(gram, (vector.get(gram) || 0) + (size === 3 ? 1.3 : 1));
      }
    }
    return vector;
  }

  function cosine(left, right) {
    if (!left.size || !right.size) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const value of left.values()) leftNorm += value * value;
    for (const value of right.values()) rightNorm += value * value;
    for (const [gram, value] of left) dot += value * (right.get(gram) || 0);
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  function tokenOverlap(left, right) {
    const a = new Set(normalize(left).split(" ").filter((token) => token.length > 1));
    const b = new Set(normalize(right).split(" ").filter((token) => token.length > 1));
    if (!a.size || !b.size) return 0;
    let common = 0;
    for (const token of a) if (b.has(token)) common += 1;
    return (2 * common) / (a.size + b.size);
  }

  function similarity(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    // Exact phrase containment handles QR captions with extra page context.
    const paddedA = ` ${a} `;
    const paddedB = ` ${b} `;
    if (paddedA.includes(paddedB) || paddedB.includes(paddedA)) return 0.96;
    return Math.max(0, Math.min(1, cosine(vectorize(a), vectorize(b)) * 0.72 + tokenOverlap(a, b) * 0.28));
  }

  function compare(qrisName, candidates) {
    const ranked = candidates.map((candidate) => {
      const value = similarity(qrisName, candidate.value);
      const sourceWeight = Math.max(0, Math.min(1, candidate.sourceWeight ?? 0.65));
      return { ...candidate, similarity: value, sourceWeight, strength: value * sourceWeight };
    }).sort((a, b) => b.strength - a.strength);
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    if (!best || best.similarity < 0.48) return { score: 0, level: "weak", best: null, ranked };

    // The score measures strength of the best available identity evidence.
    // It is intentionally conservative with weak matches and ambiguous ties.
    const isCompetingIdentity = second && best.identity && second.identity && best.identity !== second.identity
      && normalize(best.value) !== normalize(second.value);
    const ambiguityPenalty = isCompetingIdentity && best.strength - second.strength < 0.08 ? 0.12 : 0;
    const score = Math.round(Math.max(0, Math.min(100, best.strength * (1 - ambiguityPenalty) * 100)));
    const level = score >= 82 ? "strong" : score >= 62 ? "moderate" : "weak";
    return { score, level, best, ranked };
  }

  globalThis.JagaLocalMatcher = Object.freeze({ similarity, compare });
})();
