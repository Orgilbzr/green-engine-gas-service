import { getAppUser } from "../../authz";

export async function GET() {
  const user = await getAppUser();
  if (!user) return Response.json({ error: "Эрхгүй хэрэглэгч" }, { status: 403 });
  return Response.json({ user });
}
