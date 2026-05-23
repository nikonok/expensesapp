import { test, expect } from "@playwright/test";

test("onboarding: signed-in user sees recovery code step and can advance", async ({ page }) => {
  // Mock POST /api/v1/auth/google (not called via signIn() in this test, but mocked
  // defensively in case any code path reaches it).
  await page.route("**/api/v1/auth/google", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "00000000-0000-7000-8000-000000000001",
          email: "user@example.com",
          displayName: "Test User",
          isAdmin: false,
        },
        device: {
          id: "00000000-0000-7000-8000-000000000002",
          label: "Browser (2026-05-23)",
        },
        needsFamilyInit: true,
      }),
    }),
  );

  // Mock POST /api/v1/family/init — verify payload shape and echo familyId back.
  await page.route("**/api/v1/family/init", async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() ?? "{}");

    expect(typeof body.familyId).toBe("string");
    expect(body.familyId.length).toBeGreaterThan(0);
    expect(typeof body.deviceEnvelope).toBe("string");
    expect(body.deviceEnvelope.length).toBeGreaterThan(0);
    expect(typeof body.recovery?.wrap).toBe("string");
    expect(typeof body.recovery?.phraseCt).toBe("string");
    expect(typeof body.recovery?.salt).toBe("string");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ familyId: body.familyId }),
    });
  });

  // Navigate to the onboarding page (fresh DB — no hasCompletedOnboarding).
  await page.goto("/onboarding");
  await page.waitForLoadState("domcontentloaded");

  // Wait until the DEV shim has attached __authStore to window.
  await page.waitForFunction(() => !!(window as any).__authStore, { timeout: 5000 });

  // Generate a real X25519 keypair in the browser context so the crypto worker
  // operations in initFamilyAndShowPhrase() receive valid key material.
  const { pubKeyBase64, pubKeyBytes, privKeyBytes } = await page.evaluate(async () => {
    const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveKey"]);
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const toB64 = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    return {
      pubKeyBase64: toB64(pubRaw),
      pubKeyBytes: Array.from(pubRaw),
      privKeyBytes: Array.from(privPkcs8),
    };
  });
  void pubKeyBase64; // used only for potential debugging

  // Hydrate the auth store directly, bypassing the real GIS / signIn() flow.
  // Also override signIn() so clicking the "Continue with Google" button is a no-op
  // that immediately resolves — handleSignIn() in SignInStep then calls onNext().
  await page.evaluate(
    ({ pub, priv }: { pub: number[]; priv: number[] }) => {
      const store = (window as any).__authStore;
      store.setState({
        user: {
          id: "00000000-0000-7000-8000-000000000001",
          email: "user@example.com",
          displayName: "Test User",
          isAdmin: false,
        },
        device: {
          id: "00000000-0000-7000-8000-000000000002",
          label: "Browser (2026-05-23)",
        },
        isSignedIn: true,
        needsFamilyInit: true,
        pendingDevicePubKey: new Uint8Array(pub),
        pendingDevicePrivKey: new Uint8Array(priv),
        error: null,
        // Override signIn so the button click becomes a no-op and onNext() fires.
        signIn: async () => {},
      });
    },
    { pub: pubKeyBytes, priv: privKeyBytes },
  );

  // Click "Continue with Google" — signIn() is now a no-op, so handleSignIn()
  // immediately calls onNext() → handleSignInNext() → goToStep(1) (recovery code).
  await page.getByRole("button", { name: /continue with google/i }).click();

  // StepRecoveryCode mounts and calls initFamilyAndShowPhrase() which:
  //   - generates familyKey + 24-word BIP39 phrase
  //   - calls cryptoWorker.wrap* operations (real WebCrypto in-worker)
  //   - POSTs /api/v1/family/init (mocked above)
  //   - persists keys in IndexedDB
  // This is async — wait until the recovery code heading is visible.
  await expect(page.locator("text=Save your recovery code")).toBeVisible({ timeout: 20000 });

  // Verify 24 word cells are rendered (the grid shows index+1 as a caption per cell).
  await expect(page.locator("text=24").first()).toBeVisible({ timeout: 5000 });

  // The Next button starts disabled until the checkbox is checked.
  const nextBtn = page.getByRole("button", { name: /^next$/i });
  await expect(nextBtn).toBeDisabled();

  // Acknowledge that the recovery code has been saved.
  await page.getByRole("checkbox").check();
  await expect(nextBtn).toBeEnabled();

  // Advance to step 2: Welcome.
  await nextBtn.click();

  // StepWelcome renders t("onboarding.welcome.cta") = "Get Started"
  await expect(page.getByRole("button", { name: /get started/i })).toBeVisible({
    timeout: 5000,
  });
});
