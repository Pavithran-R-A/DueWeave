export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          amount_paise: number | null
          client_id: string | null
          created_at: string
          id: string
          metadata: Json
          note: string | null
          occurred_at: string
          owner_id: string
          promise_id: string | null
          receivable_id: string | null
          type: string
        }
        Insert: {
          amount_paise?: number | null
          client_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          occurred_at?: string
          owner_id: string
          promise_id?: string | null
          receivable_id?: string | null
          type: string
        }
        Update: {
          amount_paise?: number | null
          client_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          occurred_at?: string
          owner_id?: string
          promise_id?: string | null
          receivable_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_promise_id_fkey"
            columns: ["promise_id"]
            isOneToOne: false
            referencedRelation: "promises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          entity_id: string | null
          entity_type: string | null
          event_name: string
          id: string
          metadata: Json
          occurred_at: string
          owner_id: string | null
        }
        Insert: {
          entity_id?: string | null
          entity_type?: string | null
          event_name: string
          id?: string
          metadata?: Json
          occurred_at?: string
          owner_id?: string | null
        }
        Update: {
          entity_id?: string | null
          entity_type?: string | null
          event_name?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          company: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          company?: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          company?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          activated_at: string | null
          id: string
          plan: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          id?: string
          plan?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          id?: string
          plan?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_admins: {
        Row: {
          created_at: string
          created_by: string | null
          note: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          note?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          note?: string
          user_id?: string
        }
        Relationships: []
      }
      founder_audit_events: {
        Row: {
          actor_user_id: string | null
          claim_id: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          target_user_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          claim_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          target_user_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          claim_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "founder_audit_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "purchase_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_offer_config: {
        Row: {
          amount_paise: number
          disclosures_status: string
          enabled: boolean
          founder_cap: number
          offer_key: string
          payee_name: string
          payment_destination_status: string
          refund_policy_status: string
          refund_policy_text: string | null
          review_window_copy: string
          support_contact: string
          support_contact_status: string
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          amount_paise?: number
          disclosures_status?: string
          enabled?: boolean
          founder_cap?: number
          offer_key: string
          payee_name?: string
          payment_destination_status?: string
          refund_policy_status?: string
          refund_policy_text?: string | null
          review_window_copy?: string
          support_contact?: string
          support_contact_status?: string
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          amount_paise?: number
          disclosures_status?: string
          enabled?: boolean
          founder_cap?: number
          offer_key?: string
          payee_name?: string
          payment_destination_status?: string
          refund_policy_status?: string
          refund_policy_text?: string | null
          review_window_copy?: string
          support_contact?: string
          support_contact_status?: string
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          method: string
          note: string | null
          owner_id: string
          paid_on: string
          receivable_id: string
          reference: string | null
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          method: string
          note?: string | null
          owner_id: string
          paid_on: string
          receivable_id: string
          reference?: string | null
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          owner_id?: string
          paid_on?: string
          receivable_id?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_name: string
          created_at: string
          currency: string
          display_name: string
          id: string
          plan: string
          timezone: string
          updated_at: string
        }
        Insert: {
          business_name?: string
          created_at?: string
          currency?: string
          display_name?: string
          id: string
          plan?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          business_name?: string
          created_at?: string
          currency?: string
          display_name?: string
          id?: string
          plan?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      promise_events: {
        Row: {
          actor_type: string
          created_at: string
          from_status: string | null
          id: string
          occurred_at: string
          owner_id: string
          promise_id: string
          reason: string
          receivable_id: string
          to_status: string
        }
        Insert: {
          actor_type?: string
          created_at?: string
          from_status?: string | null
          id?: string
          occurred_at?: string
          owner_id: string
          promise_id: string
          reason?: string
          receivable_id: string
          to_status: string
        }
        Update: {
          actor_type?: string
          created_at?: string
          from_status?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string
          promise_id?: string
          reason?: string
          receivable_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "promise_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promise_events_promise_id_fkey"
            columns: ["promise_id"]
            isOneToOne: false
            referencedRelation: "promises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promise_events_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      promises: {
        Row: {
          created_at: string
          id: string
          note: string | null
          owner_id: string
          promised_amount_paise: number
          promised_date: string
          receivable_id: string
          resolved_at: string | null
          sequence_no: number
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id: string
          promised_amount_paise: number
          promised_date: string
          receivable_id: string
          resolved_at?: string | null
          sequence_no: number
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id?: string
          promised_amount_paise?: number
          promised_date?: string
          receivable_id?: string
          resolved_at?: string | null
          sequence_no?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promises_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_claims: {
        Row: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        Insert: {
          amount_paise?: number
          claim_id?: string
          created_at?: string
          id?: string
          owner_id: string
          payer_name: string
          plan?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          utr_reference: string
          verified_at?: string | null
        }
        Update: {
          amount_paise?: number
          claim_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          payer_name?: string
          plan?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          utr_reference?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_claims_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          amount_due_paise: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          invoice_ref: string | null
          label: string
          notes: string | null
          outstanding_paise: number
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_due_paise: number
          client_id: string
          created_at?: string
          due_date: string
          id?: string
          invoice_ref?: string | null
          label: string
          notes?: string | null
          outstanding_paise: number
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due_paise?: number
          client_id?: string
          created_at?: string
          due_date?: string
          id?: string
          invoice_ref?: string | null
          label?: string
          notes?: string | null
          outstanding_paise?: number
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_founder_claim: {
        Args: { p_claim_id: string }
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_founder_admin: { Args: never; Returns: undefined }
      assert_stage3_client_input: {
        Args: {
          p_email: string
          p_name: string
          p_notes: string
          p_phone: string
        }
        Returns: {
          email: string
          name: string
          notes: string
          phone: string
        }[]
      }
      cancel_founder_claim: {
        Args: { p_claim_id: string }
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client: {
        Args: {
          p_company?: string
          p_email?: string
          p_name: string
          p_notes?: string
          p_phone?: string
        }
        Returns: {
          archived_at: string | null
          company: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client_and_receivable: {
        Args: {
          p_amount_due_paise: number
          p_client_name: string
          p_client_notes: string
          p_company: string
          p_due_date: string
          p_email: string
          p_invoice_ref: string
          p_label: string
          p_notes: string
          p_phone: string
        }
        Returns: {
          amount_due_paise: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          invoice_ref: string | null
          label: string
          notes: string | null
          outstanding_paise: number
          owner_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "receivables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_founder_claim: {
        Args: never
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_promise: {
        Args: {
          p_note: string
          p_promised_amount_paise: number
          p_promised_date: string
          p_receivable_id: string
          p_source: string
        }
        Returns: {
          created_at: string
          id: string
          note: string | null
          owner_id: string
          promised_amount_paise: number
          promised_date: string
          receivable_id: string
          resolved_at: string | null
          sequence_no: number
          source: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "promises"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_receivable: {
        Args: {
          p_amount_due_paise: number
          p_client_id: string
          p_due_date: string
          p_invoice_ref: string
          p_label: string
          p_notes?: string
        }
        Returns: {
          amount_due_paise: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          invoice_ref: string | null
          label: string
          notes: string | null
          outstanding_paise: number
          owner_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "receivables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_my_business_data: { Args: never; Returns: undefined }
      get_founder_funnel: {
        Args: never
        Returns: {
          event_count: number
          event_name: string
        }[]
      }
      get_founder_offer: {
        Args: never
        Returns: {
          amount_paise: number
          available_spots: number
          disclosures_status: string
          enabled: boolean
          founder_cap: number
          payee_name: string
          payment_destination_status: string
          refund_policy_status: string
          refund_policy_text: string
          review_window_copy: string
          support_contact: string
          support_contact_status: string
          upi_id: string
        }[]
      }
      is_founder_admin: { Args: never; Returns: boolean }
      list_pending_founder_claims: {
        Args: never
        Returns: {
          amount_paise: number
          claim_id: string
          owner_email: string
          owner_id: string
          payer_name: string
          submitted_at: string
          utr_reference: string
        }[]
      }
      list_rejected_founder_claims: {
        Args: never
        Returns: {
          amount_paise: number
          claim_id: string
          owner_email: string
          owner_id: string
          payer_name: string
          rejected_at: string
          rejection_note: string
          utr_reference: string
        }[]
      }
      mark_due_promises_broken: { Args: never; Returns: number }
      reconsider_founder_claim: {
        Args: {
          p_bank_history_verified: boolean
          p_claim_id: string
          p_note?: string
        }
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_contacted: {
        Args: { p_note?: string; p_receivable_id: string }
        Returns: {
          amount_paise: number | null
          client_id: string | null
          created_at: string
          id: string
          metadata: Json
          note: string | null
          occurred_at: string
          owner_id: string
          promise_id: string | null
          receivable_id: string | null
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_founder_upgrade_view: { Args: never; Returns: undefined }
      record_payment: {
        Args: {
          p_amount_paise: number
          p_method: string
          p_note?: string
          p_paid_on: string
          p_receivable_id: string
          p_reference: string
        }
        Returns: {
          amount_paise: number
          created_at: string
          id: string
          method: string
          note: string | null
          owner_id: string
          paid_on: string
          receivable_id: string
          reference: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_founder_claim: {
        Args: { p_claim_id: string; p_reason?: string }
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_founder_entitlement: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      snooze_receivable: {
        Args: { p_receivable_id: string; p_until: string }
        Returns: {
          amount_paise: number | null
          client_id: string | null
          created_at: string
          id: string
          metadata: Json
          note: string | null
          occurred_at: string
          owner_id: string
          promise_id: string | null
          receivable_id: string | null
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_founder_payment: {
        Args: {
          p_claim_id: string
          p_payer_name: string
          p_utr_reference: string
        }
        Returns: {
          amount_paise: number
          claim_id: string
          created_at: string
          id: string
          owner_id: string
          payer_name: string
          plan: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          utr_reference: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "purchase_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client: {
        Args: {
          p_client_id: string
          p_company?: string
          p_email?: string
          p_expected_updated_at?: string
          p_name: string
          p_notes?: string
          p_phone?: string
        }
        Returns: {
          archived_at: string | null
          company: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_receivable_details: {
        Args: {
          p_expected_updated_at?: string
          p_invoice_ref?: string
          p_label: string
          p_notes?: string
          p_receivable_id: string
        }
        Returns: {
          amount_due_paise: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          invoice_ref: string | null
          label: string
          notes: string | null
          outstanding_paise: number
          owner_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "receivables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

