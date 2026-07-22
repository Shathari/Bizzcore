import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "../src/integrations/email";

describe("email: multi-provider adapter with retries", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.POSTMARK_SERVER_TOKEN;
  });

  it("runs in mock mode when the selected provider has no credentials", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result).toEqual({ delivered: false, mode: "mock" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches to Resend when EMAIL_PROVIDER=resend", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_fake";
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_fake" });
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ["test@example.com"], subject: "Hi" });
  });

  it("dispatches to SendGrid when EMAIL_PROVIDER=sendgrid, splitting the from header into email/name", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "sg_fake";
    process.env.EMAIL_FROM = "BizzCore <no-reply@bizzcore.example>";
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(init.body as string);
    expect(body.from).toEqual({ email: "no-reply@bizzcore.example", name: "BizzCore" });
  });

  it("dispatches to Postmark when EMAIL_PROVIDER=postmark", async () => {
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "pm_fake";
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.headers).toMatchObject({ "X-Postmark-Server-Token": "pm_fake" });
  });

  it("retries a transient (5xx) failure and succeeds on the next attempt", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_fake";
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "temporarily unavailable" } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result).toEqual({ delivered: true, mode: "live" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 10000);

  it("does not retry a permanent (4xx) failure", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_fake";
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("401");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces the last error after exhausting all retries", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_fake";
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" } as Response);

    const result = await sendEmail({ to: "test@example.com", subject: "Hi", text: "hello" });
    expect(result.delivered).toBe(false);
    expect(result.mode).toBe("live");
    expect(result.error).toContain("500");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 10000);
});
