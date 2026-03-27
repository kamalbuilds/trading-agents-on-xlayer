/**
 * YouTube Transcript Fetcher
 * Uses yt-dlp (must be installed) to download and parse video transcripts.
 * Agents use this to autonomously research trading strategies from YouTube.
 */

import { execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TranscriptSegment {
  startTime: number; // seconds
  endTime: number;
  text: string;
}

export interface VideoTranscript {
  videoId: string;
  url: string;
  segments: TranscriptSegment[];
  plainText: string;
  fetchedAt: string;
}

/**
 * Extract video ID from various YouTube URL formats
 */
function extractVideoId(urlOrId: string): string {
  // Already a video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from: ${urlOrId}`);
}

/**
 * Parse VTT subtitle file into segments
 */
function parseVTT(vttContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vttContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Match timestamp lines: 00:00:01.750 --> 00:00:04.309
    const timeMatch = line.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
    );

    if (timeMatch) {
      const startTime = parseTimestamp(timeMatch[1]);
      const endTime = parseTimestamp(timeMatch[2]);

      // Collect text lines until empty line
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        // Strip VTT formatting tags
        const cleanLine = lines[i]
          .replace(/<[^>]*>/g, '')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/&nbsp;/g, ' ')
          .trim();
        if (cleanLine) textLines.push(cleanLine);
        i++;
      }

      if (textLines.length > 0) {
        segments.push({
          startTime,
          endTime,
          text: textLines.join(' '),
        });
      }
    }
    i++;
  }

  return segments;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Deduplicate segments (VTT often has overlapping repeated lines)
 */
function deduplicateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const seen = new Set<string>();
  return segments.filter((seg) => {
    if (seen.has(seg.text)) return false;
    seen.add(seg.text);
    return true;
  });
}

/**
 * Fetch transcript for a YouTube video using yt-dlp
 */
export async function fetchTranscript(urlOrId: string): Promise<VideoTranscript> {
  const videoId = extractVideoId(urlOrId);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputPath = join(tmpdir(), `yt-transcript-${videoId}`);
  const vttPath = `${outputPath}.en.vtt`;

  try {
    // Download auto-generated English subtitles
    execSync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o "${outputPath}" "${url}" 2>/dev/null`,
      { timeout: 30000 }
    );

    if (!existsSync(vttPath)) {
      throw new Error(`No English subtitles available for ${videoId}`);
    }

    const vttContent = readFileSync(vttPath, 'utf-8');
    const rawSegments = parseVTT(vttContent);
    const segments = deduplicateSegments(rawSegments);
    const plainText = segments.map((s) => s.text).join(' ');

    // Cleanup temp file
    try { unlinkSync(vttPath); } catch { /* ignore */ }

    return {
      videoId,
      url,
      segments,
      plainText,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Cleanup on error
    try { unlinkSync(vttPath); } catch { /* ignore */ }
    throw error;
  }
}

/**
 * List recent videos from a YouTube channel
 */
export async function listChannelVideos(
  channelUrl: string,
  limit = 10
): Promise<Array<{ id: string; title: string }>> {
  const output = execSync(
    `yt-dlp --flat-playlist --print "%(id)s|||%(title)s" "${channelUrl}/videos" 2>/dev/null`,
    { timeout: 30000 }
  ).toString();

  return output
    .trim()
    .split('\n')
    .slice(0, limit)
    .map((line) => {
      const [id, title] = line.split('|||');
      return { id: id.trim(), title: title?.trim() || '' };
    })
    .filter((v) => v.id);
}

/**
 * Search YouTube and return video IDs
 */
export async function searchYouTube(
  query: string,
  limit = 5
): Promise<Array<{ id: string; title: string }>> {
  const output = execSync(
    `yt-dlp --flat-playlist --print "%(id)s|||%(title)s" "ytsearch${limit}:${query}" 2>/dev/null`,
    { timeout: 30000 }
  ).toString();

  return output
    .trim()
    .split('\n')
    .map((line) => {
      const [id, title] = line.split('|||');
      return { id: id.trim(), title: title?.trim() || '' };
    })
    .filter((v) => v.id);
}
