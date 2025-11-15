import { useCallback, useEffect } from "react";

import { useAppDispatch } from "../hooks/store";
import { removeNotification } from "../slices/notifications";

import "./Toast.scss";

type ToastProps = {
  id: number;
  children: React.ReactNode;
};

function Toast(props: ToastProps) {
  const dispatch = useAppDispatch();

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch(removeNotification(props.id));
    }, 4000);
    return () => clearTimeout(timer);
  }, [dispatch, props.id]);

  const dismiss = useCallback(() => {
    dispatch(removeNotification(props.id));
  }, [dispatch, props.id]);

  return (
    <div className="toast">
      {props.children}
      <button onClick={dismiss}>Dismiss</button>
    </div>
  );
}

export default Toast;
