export type Photo = { id: number; is_primary: boolean };
export type Profile = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  age: number | null;
  city: string;
  bio: string;
  tags: string[];
  gender: string;
  preferences: string[];
  photo_id?: number;
  photos?: Photo[];
  distance?: number;
  fame: number;
  common_tags?: number;
  connected?: boolean;
  liked?: boolean;
  likes_you?: boolean;
  online?: boolean;
  last_seen?: string;
};
export type Me = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  gender: string | null;
  preferences: string[];
  bio: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  tags: string[];
  photos: Photo[];
};
export type Notification = {
  id: number;
  actor: number;
  username: string;
  first_name: string;
  photo_id: number | null;
  kind: string;
  is_read: boolean;
  created_at: string;
};
export type Message = {
  id: number;
  actor: number;
  target: number;
  body: string;
  created_at: string;
  is_read: boolean;
};
export type Conversation = {
  id: number;
  username: string;
  first_name: string;
  photo_id: number | null;
  preview: string | null;
  unread: number;
};
export type Interest = {
  actor: number;
  username: string;
  first_name: string;
  city: string | null;
  photo_id: number | null;
  connected: boolean;
};
export type Activity = {
  visitors: {
    id: number;
    actor: number;
    username: string;
    created_at: string;
  }[];
  likes: Interest[];
  sent: Interest[];
  blocks: { actor: number; username: string }[];
  next_before: number | null;
};
export type Runner = (task: () => Promise<void>) => Promise<void>;
