import { useEffect, useRef } from "react";

import { useGetMediaEpisodesQuery } from "../../api/v1/media";
import SelectMediaFileEpisode from "../../Modals/SelectMediaFile/Activators/Episode";
import SelectMediaFile from "../../Modals/SelectMediaFile/Index";

function MediaEpisodes(props) {
  const { setActiveId } = props;

  const episodesDiv = useRef(null);

  useEffect(() => {
    episodesDiv.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const { data: episodes } = useGetMediaEpisodesQuery(props.seasonID);

  useEffect(() => {
    if (episodes && episodes[0]) setActiveId(episodes[0].id);
  }, [setActiveId, episodes]);

  if (!episodes) return null;

  return (
    <section>
      <h2>Episodes</h2>
      {episodes.length === 0 && <p className="desc">Empty</p>}
      {episodes.length > 0 && (
        <div className="episodes" ref={episodesDiv}>
          {episodes.map((ep) => (
            <SelectMediaFile
              key={ep.id}
              title={`Episode ${ep.episode}`}
              mediaID={ep.id}
              progress={ep.progress}
              onPlay={() => {
                console.log('[Episodes] Play triggered with progress:', ep.progress);
                if (typeof ep.progress !== 'number') {
                  console.warn('[Episodes] progress is not a number:', ep.progress);
                }
                props.onPlay?.(typeof ep.progress === 'number' ? ep.progress : 0);
              }}
            >
              <SelectMediaFileEpisode
                number={ep.episode}
                thumbnail={ep.thumbnail_url}
                onHover={() => setActiveId(ep.id)}
              />
            </SelectMediaFile>
          ))}
        </div>
      )}
    </section>
  );
}

export default MediaEpisodes;
