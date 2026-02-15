import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBh1z56FhbZCcPvNVkzQbEyFBZF-tJ27dE',
  authDomain: 'book-friend-finder.firebaseapp.com',
  projectId: 'book-friend-finder',
  storageBucket: 'book-friend-finder.firebasestorage.app',
  messagingSenderId: '770103525576',
  appId: '1:770103525576:web:3a205d26183090ae71a5fd',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
