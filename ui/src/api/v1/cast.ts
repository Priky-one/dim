import v1 from "./";

export interface CastDevice {
  device_id: string;
  name: string;
  device_type: string;
  capabilities: DeviceCapabilities;
  last_seen: string;
}

export interface DeviceCapabilities {
  direct_play: boolean;
  video_codecs: string[];
  audio_codecs: string[];
  subtitle_formats: string[];
  max_resolution?: string;
}

export interface CastSession {
  session_id: string;
  device_id: string;
  media_file_id: number;
  user_identifier: string;
  state: "stopped" | "playing" | "paused" | "buffering";
  position_ms: number;
  volume: number; // 0-100
  created_at: string;
  updated_at: string;
}

export interface StartCastResponse {
  session_id: string;
  media_url: string;
  media_info: MediaInfo;
  file_path: string;
}

export interface MediaInfo {
  id: number;
  title: string;
  duration_ms: number;
  video_codec?: string;
  audio_codec?: string;
  resolution?: string;
  direct_play: boolean;
  audio_tracks: AudioTrack[];
  subtitle_tracks: SubtitleTrack[];
}

export interface AudioTrack {
  index: number;
  language?: string;
  codec: string;
  channels: number;
}

export interface SubtitleTrack {
  index: number;
  language?: string;
  format: string;
  url: string;
}

export const cast = v1.injectEndpoints({
  endpoints: (build) => ({
    getCastDevices: build.query<{ devices: CastDevice[] }, void>({
      query: () => "cast/devices",
    }),
    startCastSession: build.mutation<
      StartCastResponse,
      { device_id: string; media_file_id: number }
    >({
      query: (params) => ({
        url: "cast/session",
        method: "POST",
        body: params,
      }),
    }),
    controlCastSession: build.mutation<
      { status: string },
      { session_id: string; action: string; position_ms?: number; volume?: number }
    >({
      query: ({ session_id, ...body }) => ({
        url: `cast/session/${session_id}`,
        method: "POST",
        body,
      }),
    }),
    getCastSession: build.query<{ session: CastSession }, string>({
      query: (session_id) => `cast/session/${session_id}`,
    }),
    getUserCastSessions: build.query<{ sessions: CastSession[] }, void>({
      query: () => "cast/sessions",
    }),
  }),
});

export const {
  useGetCastDevicesQuery,
  useStartCastSessionMutation,
  useControlCastSessionMutation,
  useGetCastSessionQuery,
  useGetUserCastSessionsQuery,
} = cast;
