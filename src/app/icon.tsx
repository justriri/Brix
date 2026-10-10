import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Generates the favicon/app icon directly from the BRIX mark's two-shape
 * design (see components/BrixMark.tsx) — kept as literal hex values here
 * since next/og's renderer doesn't resolve CSS custom properties. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090a",
          borderRadius: 14,
        }}
      >
        <div style={{ position: "relative", width: 42, height: 42, display: "flex" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: "4.5px solid #f4f4f2",
              borderRadius: 12,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -6,
              bottom: -6,
              width: 26,
              height: 26,
              background: "#f0b90b",
              borderRadius: 9,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
