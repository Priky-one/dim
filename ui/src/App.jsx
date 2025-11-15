import React from "react";
import { useState, useCallback } from "react";
import { BrowserRouter, Switch } from "react-router-dom";

import WS from "./Components/WS";
import CastControlBar from "./Components/CastControlBar";

import ThemeController from "./Controllers/Theme";
import FaviconController from "./Controllers/Favicon";

import NotAuthedOnlyRoute from "./Routes/NotAuthedOnly";
import PrivateRoute from "./Routes/Private";
import MainLayout from "./Layouts/MainLayout";
import Notifications from "./Components/Notifications";

import Dashboard from "./Pages/Dashboard/Index";
import Library from "./Pages/Library/Index";
import Media from "./Pages/Media/Index";
import VideoPlayer from "./Pages/VideoPlayer/Index";
import SearchResults from "./Pages/SearchResults/Index";
import Login from "./Pages/Auth/Login";
import Register from "./Pages/Auth/Register";
import Preferences from "./Pages/Preferences/Index";

import "./App.scss";

const App = () => {
  const [resumePosition, setResumePosition] = useState(undefined);
  const handlePlay = useCallback((position) => {
    console.log('[App] handlePlay called with position:', position);
    setResumePosition(position);
  }, []);

  return (
    <>
      <ThemeController />
      <FaviconController />
      <WS>
        <BrowserRouter>
          <Switch>
            <NotAuthedOnlyRoute exact path="/login">
              <Login />
            </NotAuthedOnlyRoute>

            <NotAuthedOnlyRoute exact path="/register">
              <Register />
            </NotAuthedOnlyRoute>

            <PrivateRoute exact path="/">
              <MainLayout>
                <Dashboard onPlay={handlePlay} />
              </MainLayout>
            </PrivateRoute>

            <PrivateRoute exact path="/library/:id">
              <MainLayout>
                <Library />
              </MainLayout>
            </PrivateRoute>

            <PrivateRoute path="/search">
              <MainLayout>
                <SearchResults />
              </MainLayout>
            </PrivateRoute>

            <PrivateRoute exact path="/media/:id">
              <MainLayout>
                <Media onPlay={handlePlay}/>
              </MainLayout>
            </PrivateRoute>

            <PrivateRoute exact path="/preferences">
              <MainLayout>
                <Preferences />
              </MainLayout>
            </PrivateRoute>

            <PrivateRoute exact path="/play/:fileID">
              <VideoPlayer />
            </PrivateRoute>
          </Switch>
        </BrowserRouter>

        <Notifications />
        <CastControlBar resumePosition={resumePosition} />
      </WS>
    </>
  );
};

export default App;
