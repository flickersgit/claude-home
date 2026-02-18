#!/usr/bin/env node

// Generate game arcade trailer using Seedance image-to-video API
// Uses actual game screenshots as source images

const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Load .env
const envPath = resolve(__dirname, ".env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...vals] = trimmed.split("=");
      process.env[key.trim()] = vals.join("=").trim();
    }
  }
} catch (e) {}

const API_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const MODEL = "seedance-1-0-pro-250528";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_TIME_MS = 300000;

const GAMES = [
  {
    name: "retro-basket",
    image: "screenshots/retro-basket.png",
    prompt: "Animate this retro basketball game scene: the pixel art player shoots the ball in an arc toward the hoop, the ball swishes through the net, confetti particles burst, the score counter ticks up, crowd confetti falls. Camera slightly zooms in on the hoop. Retro 8-bit pixel art style, neon orange glow effects, CRT scanlines. --resolution 720p --duration 5",
  },
  {
    name: "retro-shooter",
    image: "screenshots/retro-shooter.png",
    prompt: "Animate this retro space shooter game: the player spaceship fires rapid green laser beams upward, alien enemies explode into pixel fragments, new enemies swarm in from the top, power-up orbs float down, screen shakes from explosions. Dark space background with stars scrolling. Retro arcade green-on-black aesthetic, CRT glow effects. --resolution 720p --duration 5",
  },
  {
    name: "obby",
    image: "screenshots/obby.png",
    prompt: "Animate this platformer obstacle course game: the small blue character jumps across platforms, narrowly avoids falling into lava below, lands on moving platforms, wall-jumps off a wall. Dark background with neon red lava glow, particle effects on landing. Retro platformer pixel art style with vibrant colors. --resolution 720p --duration 5",
  },
  {
    name: "retro-racing",
    image: "screenshots/retro-racing.png",
    prompt: "Animate this space racing game: the glowing spaceship accelerates forward through a space track, asteroids tumble past, energy orbs are collected with a flash, warp speed lines streak past, blue neon track borders pulse. Dark deep space background with nebula. Fast-paced futuristic racing feel, CRT scanline effect. --resolution 720p --duration 5",
  },
];

async function createImageToVideoTask(apiKey, imagePath, prompt) {
  const imageData = readFileSync(resolve(__dirname, imagePath));
  const base64Image = imageData.toString("base64");
  const mimeType = "image/png";
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  const res = await fetch(`${API_BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create task (${res.status}): ${body}`);
  }

  const data = await res.json();
  console.log(`  Task created: ${data.id}`);
  return data.id;
}

async function pollTask(apiKey, taskId) {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_TIME_MS) {
    const res = await fetch(`${API_BASE}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Poll failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    process.stdout.write(`  Status: ${data.status}\r`);

    if (data.status === "succeeded") {
      console.log(`  Status: succeeded!`);
      let videoUrl;
      if (typeof data.content?.video_url === "string") {
        videoUrl = data.content.video_url;
      } else if (data.content?.video_url?.url) {
        videoUrl = data.content.video_url.url;
      } else if (Array.isArray(data.content)) {
        const vc = data.content.find((c) => c.type === "video_url");
        videoUrl = vc?.video_url?.url || vc?.video_url;
      }
      if (!videoUrl) {
        console.error("  No video URL found:", JSON.stringify(data, null, 2));
        return null;
      }
      return videoUrl;
    }
    if (data.status === "failed") {
      console.error(`  Task failed:`, JSON.stringify(data));
      return null;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error("  Timed out!");
  return null;
}

async function downloadVideo(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(__dirname, filename), buffer);
  console.log(`  Saved: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const apiKey = process.env.SEEDANCE_API_KEY;
  if (!apiKey) {
    console.error("Error: Set SEEDANCE_API_KEY in .env");
    process.exit(1);
  }

  console.log("=== Game Arcade Trailer Generator ===\n");

  // Launch all 4 tasks in parallel
  console.log("Creating all 4 video tasks in parallel...\n");
  const tasks = await Promise.all(
    GAMES.map(async (game) => {
      console.log(`[${game.name}] Creating task...`);
      try {
        const taskId = await createImageToVideoTask(apiKey, game.image, game.prompt);
        return { game, taskId };
      } catch (err) {
        console.error(`[${game.name}] Error: ${err.message}`);
        return { game, taskId: null };
      }
    })
  );

  // Poll all tasks
  console.log("\nPolling for completion...\n");
  for (const { game, taskId } of tasks) {
    if (!taskId) continue;
    console.log(`[${game.name}] Waiting...`);
    const videoUrl = await pollTask(apiKey, taskId);
    if (videoUrl) {
      await downloadVideo(videoUrl, `trailer-${game.name}.mp4`);
    }
  }

  console.log("\n=== All done! ===");
  console.log("Generated clips: trailer-retro-basket.mp4, trailer-retro-shooter.mp4, trailer-obby.mp4, trailer-retro-racing.mp4");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
