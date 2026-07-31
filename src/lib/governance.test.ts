import { describe, expect, it } from "vitest";
import { computeProposalResult, isEligibleVoter, isVotingOpen, type ProposalResultInput } from "./governance";

const base: ProposalResultInput = {
  votingClosesAt: "2026-08-01T00:00:00Z",
  now: "2026-08-02T00:00:00Z",
  forCount: 0,
  againstCount: 0,
  abstainCount: 0,
  eligibleVoterCount: 10,
  quorumPercent: null,
  approvalThresholdPercent: 50,
};

describe("computeProposalResult", () => {
  it("is 'voting' before the voting window closes", () => {
    const result = computeProposalResult({ ...base, now: "2026-07-31T00:00:00Z" });
    expect(result).toBe("voting");
  });

  it("is 'voting' exactly at the close instant is not yet closed... closes strictly after", () => {
    // now === votingClosesAt: the window is [opens, closes) elsewhere, so
    // the closing instant itself counts as closed for result purposes.
    const result = computeProposalResult({ ...base, now: "2026-08-01T00:00:00Z" });
    expect(result).not.toBe("voting");
  });

  it("passes when for-votes clear the approval threshold with no quorum requirement", () => {
    const result = computeProposalResult({ ...base, forCount: 6, againstCount: 4 });
    expect(result).toBe("passed");
  });

  it("rejects when for-votes fall short of the threshold", () => {
    const result = computeProposalResult({ ...base, forCount: 4, againstCount: 6 });
    expect(result).toBe("rejected");
  });

  it("is exactly at the threshold boundary: >= passes", () => {
    const atThreshold = computeProposalResult({
      ...base,
      forCount: 5,
      againstCount: 5,
      approvalThresholdPercent: 50,
    });
    expect(atThreshold).toBe("passed");

    const justBelow = computeProposalResult({
      ...base,
      forCount: 49,
      againstCount: 51,
      approvalThresholdPercent: 50,
    });
    expect(justBelow).toBe("rejected");
  });

  it("abstain votes count toward quorum but not toward the approval ratio", () => {
    const result = computeProposalResult({
      ...base,
      forCount: 3,
      againstCount: 1,
      abstainCount: 6,
      eligibleVoterCount: 10,
      quorumPercent: 100,
    });
    // Quorum: (3+1+6)/10 = 100% → met. Approval: 3/(3+1) = 75% >= 50% → passed.
    expect(result).toBe("passed");
  });

  it("fails quorum when too few eligible members voted at all", () => {
    const result = computeProposalResult({
      ...base,
      forCount: 2,
      againstCount: 0,
      eligibleVoterCount: 10,
      quorumPercent: 50,
    });
    // Only 2/10 = 20% voted, quorum requires 50%.
    expect(result).toBe("quorum_not_met");
  });

  it("with no votes cast and no quorum requirement, resolves to rejected, not passed", () => {
    const result = computeProposalResult(base);
    expect(result).toBe("rejected");
  });

  it("treats zero eligible voters as quorum trivially met (division-by-zero guard)", () => {
    const result = computeProposalResult({
      ...base,
      forCount: 1,
      againstCount: 0,
      eligibleVoterCount: 0,
      quorumPercent: 50,
    });
    expect(result).toBe("passed");
  });
});

describe("isEligibleVoter", () => {
  it("is eligible when the member joined before voting opened", () => {
    expect(
      isEligibleVoter({
        memberJoinedAt: "2026-01-01T00:00:00Z",
        membershipStatus: "active",
        votingOpensAt: "2026-02-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is eligible when the member joined at exactly the voting-opens instant", () => {
    expect(
      isEligibleVoter({
        memberJoinedAt: "2026-02-01T00:00:00Z",
        membershipStatus: "active",
        votingOpensAt: "2026-02-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is ineligible when the member joined after voting opened", () => {
    expect(
      isEligibleVoter({
        memberJoinedAt: "2026-02-02T00:00:00Z",
        membershipStatus: "active",
        votingOpensAt: "2026-02-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("is ineligible for a non-active member regardless of join date", () => {
    expect(
      isEligibleVoter({
        memberJoinedAt: "2026-01-01T00:00:00Z",
        membershipStatus: "suspended",
        votingOpensAt: "2026-02-01T00:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("isVotingOpen", () => {
  it("is closed before the window opens", () => {
    expect(
      isVotingOpen({ now: "2026-01-01T00:00:00Z", votingOpensAt: "2026-02-01T00:00:00Z", votingClosesAt: "2026-03-01T00:00:00Z" }),
    ).toBe(false);
  });

  it("is open at the exact opening instant", () => {
    expect(
      isVotingOpen({ now: "2026-02-01T00:00:00Z", votingOpensAt: "2026-02-01T00:00:00Z", votingClosesAt: "2026-03-01T00:00:00Z" }),
    ).toBe(true);
  });

  it("is closed at the exact closing instant", () => {
    expect(
      isVotingOpen({ now: "2026-03-01T00:00:00Z", votingOpensAt: "2026-02-01T00:00:00Z", votingClosesAt: "2026-03-01T00:00:00Z" }),
    ).toBe(false);
  });

  it("is open strictly between the two instants", () => {
    expect(
      isVotingOpen({ now: "2026-02-15T00:00:00Z", votingOpensAt: "2026-02-01T00:00:00Z", votingClosesAt: "2026-03-01T00:00:00Z" }),
    ).toBe(true);
  });
});
