import { nowIso } from "../shared/time.js";
import type { BusinessLead, BusinessSearchCriteria, FreelanceLead, FreelanceSearchCriteria } from "./types.js";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreLabel(score: number): string {
  if (score >= 90) return `${score}/100 — Excellent Opportunity`;
  if (score >= 80) return `${score}/100 — Strong Opportunity`;
  if (score >= 65) return `${score}/100 — Worth Considering`;
  return `${score}/100 — Low Priority`;
}

function countMatches(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token.toLowerCase()) ? 1 : 0), 0);
}

function splitTokens(values: string[]): string[] {
  return values.flatMap((value) => value.split(/[,\n/]/g).map((item) => item.trim()).filter(Boolean));
}

export function scoreFreelanceLead(
  lead: Omit<FreelanceLead, "technicalFitScore" | "budgetFitScore" | "clientQualityScore" | "competitionScore" | "overallScore" | "scoreLabel" | "recommendedApproach" | "reasonForRecommendation" | "status" | "kind" | "discoveredAt"> & { discoveredAt?: string },
  criteria: FreelanceSearchCriteria,
): FreelanceLead {
  const searchable = [lead.title, lead.summary, lead.description ?? "", ...lead.skills, criteria.objective, ...criteria.keywords, ...criteria.skills, ...criteria.preferredTechnologies].join(" ");
  const skillMatches = countMatches(searchable, splitTokens([...criteria.skills, ...criteria.keywords, ...criteria.preferredTechnologies]));
  const technicalFitScore = clampScore(48 + skillMatches * 10 + Math.min(12, lead.skills.length * 2));

  const budgetText = `${lead.budget ?? ""} ${lead.hourlyRate ?? ""}`.toLowerCase();
  const minBudget = criteria.minBudget ?? 0;
  const maxBudget = criteria.maxBudget ?? Number.POSITIVE_INFINITY;
  let budgetFitScore = 55;
  if (budgetText.includes("$")) {
    const numericBudget = Number((budgetText.match(/(\d[\d,]*)/)?.[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(numericBudget)) {
      if (numericBudget >= minBudget && numericBudget <= maxBudget) budgetFitScore = 88;
      else if (numericBudget >= minBudget) budgetFitScore = 72;
      else budgetFitScore = 42;
    }
  }
  if (lead.budgetType === "hourly" && criteria.budgetType === "hourly") {
    budgetFitScore += 8;
  }
  if (lead.budgetType === "fixed" && criteria.budgetType === "fixed_price") {
    budgetFitScore += 8;
  }

  const reviews = lead.clientReviewCount ?? 0;
  const rating = Number.parseFloat((lead.clientRating ?? "").replace(/[^\d.]/g, ""));
  const qualityBase = Number.isFinite(rating) ? rating * 18 : 60;
  const clientQualityScore = clampScore(qualityBase + Math.min(15, reviews / 4) + (lead.clientHireRate?.includes("%") ? 8 : 0));

  const competitionScore = clampScore(lead.competitionCount ? 100 - Math.min(70, lead.competitionCount * 4) : 62);
  const overallScore = clampScore((technicalFitScore * 0.38) + (budgetFitScore * 0.24) + (clientQualityScore * 0.22) + (competitionScore * 0.16));
  const reasonForRecommendation = [
    `Strongest fit: ${technicalFitScore}% technical match`,
    `Budget signal: ${budgetFitScore}%`,
    `Client quality signal: ${clientQualityScore}%`,
    lead.competitionCount ? `Competition looks manageable (${lead.competitionCount} bids)` : "Competition level unavailable",
  ].join(". ");

  const recommendedBid = lead.budget?.includes("$")
    ? lead.budget
    : criteria.minBudget
      ? `$${Math.round(criteria.minBudget * 1.3)}`
      : undefined;

  const recommendedApproach = `Open with a short, specific proposal that mirrors the project's wording and highlights the exact skills: ${criteria.skills.slice(0, 3).join(", ") || criteria.keywords.slice(0, 3).join(", ") || "your core service offering"}.`;

  return {
    ...lead,
    kind: "freelance",
    technicalFitScore,
    budgetFitScore,
    clientQualityScore,
    competitionScore,
    overallScore,
    scoreLabel: scoreLabel(overallScore),
    recommendedBid,
    recommendedApproach,
    reasonForRecommendation,
    discoveredAt: lead.discoveredAt ?? nowIso(),
    status: "new",
  };
}

export function scoreBusinessLead(
  lead: Omit<BusinessLead, "qualificationScore" | "fitScore" | "opportunityScore" | "overallScore" | "scoreLabel" | "reasonForRecommendation" | "status" | "kind" | "discoveredAt"> & { discoveredAt?: string },
  criteria: BusinessSearchCriteria,
): BusinessLead {
  const searchable = [lead.businessName, lead.businessType, lead.industry, lead.description ?? "", lead.services.join(" "), criteria.location, criteria.targetCustomer ?? "", criteria.additionalCriteria ?? "", ...criteria.businessTypes, ...criteria.industries, ...criteria.keywords].join(" ");
  const fitHits = countMatches(searchable, splitTokens([...criteria.businessTypes, ...criteria.industries, ...criteria.keywords]));
  const fitScore = clampScore(48 + fitHits * 10 + (lead.location?.toLowerCase().includes(criteria.location.toLowerCase()) ? 12 : 0));

  const hasWebsite = Boolean(lead.website);
  const hasSocial = lead.socialProfiles.length > 0;
  const qualificationScore = clampScore(60 + (hasWebsite ? 10 : -8) + (hasSocial ? 8 : -4) + (lead.phone ? 8 : 0) + (lead.email ? 4 : 0));

  const opportunitySignals = [
    lead.description?.match(/website|seo|marketing|booking|contact|lead generation/i) ? 15 : 0,
    lead.description?.match(/outdated|slow|missing|weak|poor/i) ? 12 : 0,
    !hasWebsite ? 10 : 0,
    hasSocial ? 5 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const opportunityScore = clampScore(52 + opportunitySignals);

  const overallScore = clampScore((fitScore * 0.36) + (qualificationScore * 0.28) + (opportunityScore * 0.36));
  const recommendedOffer = criteria.profileId === "getsparkd"
    ? "Offer a free local SEO and lead-generation audit with a fast, practical action list."
    : "Offer a targeted partnership or demo that shows how Nutra Vida helps their audience capture nutrition data and stay engaged.";
  const potentialNeed = lead.description?.match(/website|seo|marketing|booking|contact|lead generation/i)
    ? "Could benefit from marketing, local SEO, website improvements, or lead-generation help."
    : criteria.profileId === "nutra_vida"
      ? "Could be a partnership or distribution opportunity for an AI nutrition workflow."
      : "Could be a good customer, referral, or partnership opportunity.";

  return {
    ...lead,
    kind: "business",
    qualificationScore,
    fitScore,
    opportunityScore,
    overallScore,
    scoreLabel: scoreLabel(overallScore),
    reasonForRecommendation: [
      `Fit signal: ${fitScore}%`,
      `Qualification signal: ${qualificationScore}%`,
      `Opportunity signal: ${opportunityScore}%`,
    ].join(". "),
    potentialNeed,
    recommendedOffer,
    status: "new",
    discoveredAt: lead.discoveredAt ?? nowIso(),
  };
}
