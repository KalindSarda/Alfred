import { describe, expect, it } from "vitest";
import { inviteEmailFromHash } from "../web/src/invite";

describe("inviteEmailFromHash", () => {
  it("reads the invited address from the link fragment, lower-cased", () => {
    expect(inviteEmailFromHash("#invite=priya%40example.com")).toBe("priya@example.com");
    expect(inviteEmailFromHash("#invite=Priya%40Example.COM")).toBe("priya@example.com");
    expect(inviteEmailFromHash("#invite=a%2Bb%40example.co")).toBe("a+b@example.co");
  });

  it("ignores anything that is not an invitation to an email address", () => {
    for (const hash of ["", "#", "#invite=", "#invite=notanemail", "#invite=a%40b", "#other=a%40b.co", "invite=a%40b.co", "#invite=%E0%A4%A"]) {
      expect(inviteEmailFromHash(hash), hash).toBeNull();
    }
  });

  it("refuses an address that is absurdly long", () => {
    expect(inviteEmailFromHash(`#invite=${"a".repeat(250)}%40example.com`)).toBeNull();
  });

  it("stops at another fragment parameter", () => {
    expect(inviteEmailFromHash("#invite=a%40b.co&x=1")).toBe("a@b.co");
  });
});
