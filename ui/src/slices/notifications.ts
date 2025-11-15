import { PayloadAction, createSlice } from "@reduxjs/toolkit";

/*
 * A message displayed to the user in a toast window.
 */
export type Notification = {
  msg: string;
};

/*
 * The slice's state. Contains a list of notifications to display.
 */
type NotificationState = {
  list: Array<Notification>;
};

const initialState: NotificationState = {
  list: [],
};

export const notifications = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    addNotification: (state, action: PayloadAction<Notification>) => {
      // Deduplicate connection notifications
      if (action.payload.msg.includes("Connection to server lost") || action.payload.msg.includes("server has been restored")) {
        if (state.list.some(n => n.msg === action.payload.msg)) return;
        // Remove previous connection notifications
        state.list = state.list.filter(n => !n.msg.includes("Connection to server lost") && !n.msg.includes("server has been restored"));
      }
      // Limit to max 3 notifications stacked
      if (state.list.length >= 3) state.list.shift();
      state.list.push(action.payload);
    },
    removeNotification: (state, action: PayloadAction<number>) => {
      state.list.splice(action.payload, 1);
    },
    clearNotifications: (state) => {
      state.list.splice(0, state.list.length);
    },
  },
});

export const { addNotification, removeNotification, clearNotifications } =
  notifications.actions;

export default notifications.reducer;
