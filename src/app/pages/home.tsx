import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";

type AppRequestInfo = RequestInfo<any, AppContext>;

export const Home = ({ ctx }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;
  return redirect(principal ? "/dashboard" : "/sign-in");
};
