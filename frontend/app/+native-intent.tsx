import { receiveFile } from "@/src/sync/incomingFile";

// Routes system URLs that are not app screens:
// - roster files opened into Foxory from Files / OneDrive / SharePoint / Mail
// - the Microsoft sign-in redirect (foxory://auth), which the sign-in flow
//   reads itself; the user stays on the Import screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(file|content):\/\//i.test(path)) {
      return receiveFile(path) ? "/(app)/import" : "/";
    }
    if (/^(foxory:\/\/)?\/?auth(\?|$)/i.test(path)) return "/(app)/import";
    return path;
  } catch {
    return "/";
  }
}
