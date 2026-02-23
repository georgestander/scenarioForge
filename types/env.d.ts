declare namespace Cloudflare {
  interface Env {
    AUTH_SECRET_KEY?: string;
    GITHUB_APP_ID?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_APP_SLUG?: string;
    GITHUB_APP_INSTALL_URL?: string;
  }
}

interface Env extends Cloudflare.Env {}
