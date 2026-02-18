#!/usr/bin/env node

// Generate a game arcade trailer video using BytePlus ModelArk Seedance API
// Usage: ARK_API_KEY=your_key node generate-trailer.js

const API_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const MODEL = "seedance-1-0-pro-250528";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_TIME_MS = 300000; // 5 minutes

const TRAILER_PROMPT = `A cinematic retro arcade game trailer montage in vibrant neon pixel art style.
The sequence opens with a glowing "GAME ARCADE" neon sign flickering to life against a dark background.
Then quick cuts between four games:
1) A basketball court with two players shooting hoops under stadium lights with a scoreboard,
2) A spaceship flying through space shooting lasers at alien enemies with explosions,
3) A character running and jumping through a colorful platformer obstacle course with moving platforms,
4) A race car speeding down a highway dodging traffic at night with neon city lights.
Fast-paced editing, retro CRT screen effects, scanlines, bright neon pink and cyan and green colors,
80s arcade aesthetic, energetic and exciting. Camera zooms and dynamic angles.
--ratio 16:9 --resolution 720p --duration 10`;

async function createTask(apiKey) {
  const res = await fetch(`${API_BASE}/content/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      content: [
        {
          type: "text",
          text: TRAILER_PROMPT,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create task (${res.status}): ${body}`);
  }

  const data = await res.json();
  const taskId = data.id;
  console.log(`Task created: ${taskId}`);
  return taskId;
}

async function pollTask(apiKey, taskId) {
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_TIME_MS) {
    const res = await fetch(`${API_BASE}/content/generations/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to poll task (${res.status}): ${body}`);
    }

    const data = await res.json();
    const status = data.status;
    console.log(`Status: ${status}`);

    if (status === "succeeded") {
      return data;
    }
    if (status === "failed") {
      throw new Error(`Task failed: ${JSON.stringify(data)}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for video generation");
}

async function downloadVideo(url, filename) {
  const { writeFile } = await import("node:fs/promises");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(filename, buffer);
  console.log(`Saved to ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    console.error("Error: Set ARK_API_KEY environment variable");
    console.error("Usage: ARK_API_KEY=your_key node generate-trailer.js");
    process.exit(1);
  }

  console.log("Creating video generation task...");
  const taskId = await createTask(apiKey);

  console.log("Polling for completion...");
  const result = await pollTask(apiKey, taskId);

  // Extract video URL from the result content
  const videoContent = result.content?.find((c) => c.type === "video_url");
  const videoUrl = videoContent?.video_url?.url;

  if (!videoUrl) {
    console.error("No video URL in response:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`Video ready: ${videoUrl}`);
  await downloadVideo(videoUrl, "trailer.mp4");
  console.log("Done! Trailer saved as trailer.mp4");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
