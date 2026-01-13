import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

export type Database = {
  public: {
    Tables: {
      predictions: {
        Row: {
          id: string;
          timeframe: string;
          datetime: string;
          value: number;
          timeframe_label: string; // Added new column
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          timeframe: string;
          datetime: string;
          value: number;
          timeframe_label: string; // Added new column
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          timeframe?: string;
          datetime?: string;
          value?: number;
          timeframe_label?: string; // Added new column
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};