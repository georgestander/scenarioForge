import { linkFor } from "rwsdk/router";
import type { App } from "rwsdk/worker";

// @ts-expect-error — route tree depth exceeds TypeScript instantiation limit
export const link = linkFor<App>();
