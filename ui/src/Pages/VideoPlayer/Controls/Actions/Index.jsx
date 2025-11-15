import { useCallback, useEffect, useContext } from "react";
import { useDispatch, useSelector } from "react-redux";

import Volume from "./Volume";
import SeekBack from "./SeekBack";
import PlayPause from "./PlayPause";
import SeekForward from "./SeekForward";
import Subtitles from "./Subtitles";
import Fullscreen from "./Fullscreen";
import VideoActionSettings from "./Settings";
import CastButton from "../../../../Components/CastButton";

import NextVideo from "./NextVideo";
import PrevVideo from "./PrevVideo";

import { VideoPlayerContext } from "../../Context";
import { updateVideo } from "../../../../actions/video";

import "./Index.scss";

function VideoActions(props) {
  const dispatch = useDispatch();

  const { video } = useSelector((store) => ({
    video: store.video,
  }));

  const { videoPlayer } = useContext(VideoPlayerContext);

  const { setVisible } = props;

  useEffect(() => {
    if (!videoPlayer.current) return;
    if (video.showSettings || video.showSubSwitcher) return;

    setVisible(video.idleCount <= 2);
    videoPlayer.current.style.cursor =
      video.idleCount <= 2 ? "default" : "none";
  }, [
    setVisible,
    video.idleCount,
    video.showSettings,
    video.showSubSwitcher,
    videoPlayer,
  ]);

  const showPlayer = useCallback(() => {
    dispatch(
      updateVideo({
        idleCount: 0,
      })
    );

    setVisible(true);

    if (videoPlayer.current) {
      videoPlayer.current.style.cursor = "default";
    }
  }, [dispatch, setVisible, videoPlayer]);

  useEffect(() => {
    document.addEventListener("mousemove", showPlayer);

    return () => {
      document.removeEventListener("mousemove", showPlayer);
    };
  }, [showPlayer]);

  const mediaFileId = video.tracks.video?.list?.[0]?.mediafile_id || 
                      video.tracks.audio?.list?.[0]?.mediafile_id;

  return (
    <div className="videoActions">
      <section className="left">
        <Volume />
      </section>
      <section className="middle">
        <PrevVideo />
        <SeekBack />
        <PlayPause />
        <SeekForward />
        <NextVideo />
      </section>
      <section className="right">
        <VideoActionSettings />
        <Subtitles />
        {mediaFileId && <CastButton mediaFileId={mediaFileId} />}
        <Fullscreen />
      </section>
    </div>
  );
}

export default VideoActions;
