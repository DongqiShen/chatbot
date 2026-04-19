import type { UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ChatTools = {
  getWeather: {
    input: {
      latitude?: number;
      longitude?: number;
      city?: string;
    };
    output:
      | {
          error: string;
        }
      | {
          latitude: number;
          longitude: number;
          generationtime_ms: number;
          utc_offset_seconds: number;
          timezone: string;
          timezone_abbreviation: string;
          elevation: number;
          cityName?: string;
          current_units: {
            time: string;
            interval: string;
            temperature_2m: string;
          };
          current: {
            time: string;
            interval: number;
            temperature_2m: number;
          };
          hourly_units: {
            time: string;
            temperature_2m: string;
          };
          hourly: {
            time: string[];
            temperature_2m: number[];
          };
          daily_units: {
            time: string;
            sunrise: string;
            sunset: string;
          };
          daily: {
            time: string[];
            sunrise: string[];
            sunset: string[];
          };
        };
  };
  createDocument: {
    input: {
      title: string;
      kind: Extract<ArtifactKind, "text" | "code" | "sheet">;
    };
    output:
      | {
          error: string;
        }
      | {
          id: string;
          title: string;
          kind: ArtifactKind;
          content: string;
        };
  };
  updateDocument: {
    input:
      | {
          id: string;
          description: string;
        }
      | {
          id: string;
          old_string: string;
          new_string: string;
          replace_all?: boolean;
        };
    output:
      | {
          error: string;
        }
      | {
          id: string;
          title: string;
          kind: ArtifactKind;
          content: string;
        };
  };
  requestSuggestions: {
    input: {
      documentId: string;
    };
    output:
      | {
          error: string;
        }
      | {
          id: string;
          title: string;
          kind: ArtifactKind;
          message: string;
        };
  };
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
