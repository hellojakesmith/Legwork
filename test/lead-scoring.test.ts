import { describe, expect, it } from "vitest";
import { scoreBusinessLead, scoreFreelanceLead } from "../src/leads/scoring.js";

describe("lead scoring", () => {
  it("scores strong freelance matches higher than weak ones", () => {
    const criteria = {
      objective: "Find Node.js and TypeScript automation work",
      keywords: ["Node.js", "TypeScript", "automation"],
      skills: ["Node.js", "TypeScript"],
      platforms: ["freelancer" as const],
      budgetType: "both" as const,
      preferredTechnologies: ["Node.js", "TypeScript"],
      projectTypes: ["Automation"],
      remotePreference: "remote" as const,
      maxLeads: 10,
    };

    const lead = scoreFreelanceLead(
      {
        id: "lead-1",
        platform: "Freelancer.com",
        title: "Node.js automation for SaaS platform",
        url: "https://example.com/project",
        summary: "Strong Node.js automation project for SaaS APIs",
        skills: ["Node.js", "TypeScript", "API integration"],
        sourceQuery: "site:freelancer.com/projects node automation",
        sourceUrl: "https://example.com/project",
        budget: "$1,200",
        budgetType: "fixed",
        recommendedApproach: "placeholder",
        reasonForRecommendation: "placeholder",
        discoveredAt: new Date().toISOString(),
        status: "new",
      },
      criteria,
    );

    expect(lead.overallScore).toBeGreaterThan(80);
    expect(lead.scoreLabel).toContain("Strong");
    expect(lead.reasonForRecommendation).toContain("technical match");
  });

  it("scores relevant business leads and surfaces recommendations", () => {
    const criteria = {
      profileId: "getsparkd" as const,
      location: "Austin, TX",
      radiusMiles: 25,
      businessTypes: ["Gyms", "Fitness Studios"],
      industries: ["Fitness", "Wellness"],
      keywords: ["local SEO", "lead generation", "website"],
      targetCustomer: "local fitness businesses",
      companySize: "small",
      websiteRequired: true,
      socialPresenceRequired: false,
      maxLeads: 15,
    };

    const lead = scoreBusinessLead(
      {
        id: "biz-1",
        businessName: "Peak Performance Gym",
        businessType: "Gym",
        industry: "Fitness",
        website: "https://peak.example",
        url: "https://peak.example",
        location: "Austin, TX",
        socialProfiles: ["https://instagram.com/peak"],
        services: ["Training", "Memberships"],
        source: "Web search",
        sourceQuery: "gyms Austin TX local SEO",
        description: "Gym with a weak website and limited local SEO presence.",
        recommendedOffer: "placeholder",
        potentialNeed: "placeholder",
        discoveredAt: new Date().toISOString(),
        status: "new",
      },
      criteria,
    );

    expect(lead.overallScore).toBeGreaterThan(70);
    expect(lead.recommendedOffer).toContain("SEO");
    expect(lead.potentialNeed).toContain("marketing");
  });
});
