function resolveClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

async function resolveLocation(ip) {
  if (!ip || ip === "::1" || ip.startsWith("127.")) {
    return { country: "", city: "", lat: null, lon: null };
  }

  if (process.env.SKIP_GEO_LOOKUP === "true") {
    return { country: "", city: "", lat: null, lon: null };
  }

  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,lat,lon`
    );
    const data = await response.json();
    if (data.status !== "success") {
      return { country: "", city: "", lat: null, lon: null };
    }
    return {
      country: data.country || "",
      city: data.city || "",
      lat: data.lat ?? null,
      lon: data.lon ?? null,
    };
  } catch {
    return { country: "", city: "", lat: null, lon: null };
  }
}

module.exports = { resolveClientIp, resolveLocation };
