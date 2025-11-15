import { useParams } from "react-router-dom";
import { useState } from "react";

import { useGetMediaQuery } from "../../api/v1/media";

import Banner from "./Banner";
import MetaContent from "./MetaContent";
import Seasons from "./Seasons";

import "./Index.scss";

function Media(props) {
  console.log('[Media] onPlay prop:', typeof props.onPlay, props.onPlay);
  const { id } = useParams();
  const [activeId, setActiveId] = useState(id);
  const { data: media } = useGetMediaQuery(id);

  return (
    <div className="mediaPage">
      <Banner onPlay={props.onPlay} />
      <div className="mediaContent">
        <div className="meta-content">
          <MetaContent activeId={activeId} onPlay={props.onPlay} />
        </div>
        {media && media.media_type === "tv" && (
          <Seasons setActiveId={setActiveId} />
        )}
      </div>
    </div>
  );
}

export default Media;
