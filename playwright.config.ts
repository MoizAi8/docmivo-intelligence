import { defineConfig } from "@playwright/test";

const local="http://127.0.0.1:3101";
const runtime=new URL(process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/docmivo_test");
if (!["localhost","127.0.0.1","[::1]"].includes(runtime.hostname)||!/\/\w+_test$/.test(runtime.pathname)) throw new Error("Expected isolated test database");
runtime.username="docmivo_runtime";
runtime.password="docmivo-local-test-runtime-password";

export default defineConfig({
  testDir:"tests/e2e",
  fullyParallel:false,
  workers:1,
  reporter:"list",
  timeout:45_000,
  use:{baseURL:local,headless:true,trace:"retain-on-failure",launchOptions:{executablePath:process.env.DOCMIVO_BROWSER}},
  webServer:{
    command:"node scripts/prepare-tests.mjs && npm run start -- --port 3101 --hostname 127.0.0.1",
    url:local+"/api/health",timeout:50_000,reuseExistingServer:false,
    env:{APP_URL:local,DATABASE_URL:runtime.href,AUTH_SECRET:"docmivo-fixture-session-secret-at-least-32",
      REGISTRATION_INVITE:"docmivo-fixture-registration-invite-at-least-32",EXTERNAL_AI_ENABLED:"false",GEMINI_API_KEY:"",
      TEST_DATABASE_URL:process.env.TEST_DATABASE_URL ?? ""}
  }
});
