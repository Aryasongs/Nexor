export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const image = form.get("image");

  if (!image) {
    return Response.json({ error: "Image missing" }, { status: 400 });
  }

  const fd = new FormData();
  fd.append("media", image, image.name || "image.jpg");
  fd.append("models", "nudity-2.1,gore,violence,weapon");
  fd.append("api_user", env.SIGHTENGINE_USER);
  fd.append("api_secret", env.SIGHTENGINE_SECRET);

  const r = await fetch("https://api.sightengine.com/1.0/check.json", {
    method: "POST",
    body: fd
  });

  const data = await r.json();
  return Response.json(data);
}
