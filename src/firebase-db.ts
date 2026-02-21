import { getFirestore } from 'firebase/firestore';
import { app } from './firebase-auth';

export const db = getFirestore(app);
