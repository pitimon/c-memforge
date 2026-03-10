/**
 * Tests for api-client security functions: SSRF protection, retry logic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { _testing } from "../api-client";

const { validateServerUrl, isPrivateHost, isRetryableError } = _testing;

describe("isPrivateHost", () => {
  test("blocks RFC1918 10.x.x.x", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("10.99.201.129")).toBe(true);
  });

  test("blocks RFC1918 172.16-31.x.x", () => {
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("172.15.0.1")).toBe(false); // outside range
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });

  test("blocks RFC1918 192.168.x.x", () => {
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  test("blocks link-local 169.254.x.x", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("169.254.0.1")).toBe(true);
  });

  test("blocks IPv6 loopback and ULA", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fd12::1")).toBe(true);
  });

  test("blocks 0.0.0.0 and [::]", () => {
    expect(isPrivateHost("0.0.0.0")).toBe(true);
    expect(isPrivateHost("[::]")).toBe(true);
  });

  test("blocks cloud metadata hosts", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("metadata.google.internal")).toBe(true);
    expect(isPrivateHost("100.100.100.200")).toBe(true);
  });

  test("allows public hosts", () => {
    expect(isPrivateHost("memclaude.thaicloud.ai")).toBe(false);
    expect(isPrivateHost("google.com")).toBe(false);
    expect(isPrivateHost("1.1.1.1")).toBe(false);
  });
});

describe("validateServerUrl", () => {
  const originalEnv = process.env.MEMFORGE_ALLOW_CUSTOM_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MEMFORGE_ALLOW_CUSTOM_URL;
    } else {
      process.env.MEMFORGE_ALLOW_CUSTOM_URL = originalEnv;
    }
  });

  test("allows HTTPS to allowed hosts", () => {
    expect(validateServerUrl("https://memclaude.thaicloud.ai")).toBe(true);
  });

  test("rejects HTTP to allowed hosts", () => {
    expect(validateServerUrl("http://memclaude.thaicloud.ai")).toBe(false);
  });

  test("rejects unknown HTTPS hosts", () => {
    expect(validateServerUrl("https://evil.com")).toBe(false);
  });

  test("allows localhost HTTP for dev", () => {
    expect(validateServerUrl("http://localhost:3000")).toBe(true);
    expect(validateServerUrl("http://127.0.0.1:3000")).toBe(true);
  });

  test("allows localhost HTTPS for dev", () => {
    expect(validateServerUrl("https://localhost:3000")).toBe(true);
  });

  test("blocks private IPs", () => {
    expect(validateServerUrl("https://10.0.0.1")).toBe(false);
    expect(validateServerUrl("https://192.168.1.1")).toBe(false);
    expect(validateServerUrl("https://172.16.0.1")).toBe(false);
  });

  test("blocks AWS IMDS even with HTTPS", () => {
    expect(validateServerUrl("https://169.254.169.254")).toBe(false);
  });

  test("blocks 0.0.0.0", () => {
    expect(validateServerUrl("http://0.0.0.0:3000")).toBe(false);
  });

  test("rejects invalid URLs", () => {
    expect(validateServerUrl("not-a-url")).toBe(false);
    expect(validateServerUrl("")).toBe(false);
  });

  describe("with MEMFORGE_ALLOW_CUSTOM_URL=1", () => {
    beforeEach(() => {
      process.env.MEMFORGE_ALLOW_CUSTOM_URL = "1";
    });

    test("allows custom HTTPS hosts", () => {
      expect(validateServerUrl("https://my-server.example.com")).toBe(true);
    });

    test("still blocks HTTP for remote hosts", () => {
      expect(validateServerUrl("http://my-server.example.com")).toBe(false);
    });

    test("still blocks cloud metadata IPs", () => {
      expect(validateServerUrl("http://169.254.169.254")).toBe(false);
      expect(validateServerUrl("https://169.254.169.254")).toBe(false);
    });

    test("still blocks private IPs", () => {
      expect(validateServerUrl("https://10.0.0.1")).toBe(false);
      expect(validateServerUrl("https://192.168.1.1")).toBe(false);
    });

    test("allows localhost HTTP in bypass mode", () => {
      expect(validateServerUrl("http://localhost:3000")).toBe(true);
    });
  });
});

describe("isRetryableError", () => {
  test("retries on fetch failed", () => {
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });

  test("retries on certificate errors", () => {
    expect(
      isRetryableError(new Error("unknown certificate verification error")),
    ).toBe(true);
  });

  test("retries on TLS/SSL errors", () => {
    expect(isRetryableError(new Error("SSL_ERROR_SYSCALL"))).toBe(true);
    expect(isRetryableError(new Error("tls handshake failed"))).toBe(true);
  });

  test("retries on connection errors", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
  });

  test("does NOT retry AbortError (timeout)", () => {
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    expect(isRetryableError(abortError)).toBe(false);
  });

  test("does NOT retry HTTP errors", () => {
    expect(isRetryableError(new Error("Remote API error (404)"))).toBe(false);
    expect(isRetryableError(new Error("HTTP 500"))).toBe(false);
  });

  test("does NOT retry non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });
});
