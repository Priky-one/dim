import { useSelector } from 'react-redux';
import { RootState } from '../../store';

export function useAuthToken() {
  return useSelector((state: RootState) => state.auth.token);
}
