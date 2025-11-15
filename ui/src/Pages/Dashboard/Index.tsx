import { useEffect } from "react";
import Banners from "./Banners/Index";
import CardList from "./CardList/Index";

interface DashboardProps {
  onPlay?: (resumePosition: number) => void;
}

function Dashboard({ onPlay }: DashboardProps) {
  console.log('[Dashboard] onPlay prop:', typeof onPlay, onPlay);
  useEffect(() => {
    document.title = "Dim - Dashboard";
  }, []);

  return (
    <div className="dashboard">
  <Banners onPlay={onPlay} />
      <CardList />
    </div>
  );
}

export default Dashboard;
