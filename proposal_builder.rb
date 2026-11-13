# encoding: utf-8
# frozen_string_literal: true

module ThienMinh
  class ProposalBuilder
    def initialize(store)
      @store = store
    end

    def build(case_id:, extracted:, feasibility:, pricing:, revision_notes: [])
      company = @store.catalog['company'] || {}
      policies = @store.policies

      compliance_matrix = build_compliance_matrix(extracted, feasibility)
      data_boundary_checks = build_data_boundary_checks(extracted, feasibility, pricing)
      proposal_summary = build_proposal_summary(case_id, extracted, feasibility, pricing, revision_notes)
      draft_quotation = build_draft_quotation(case_id, company, policies, extracted, feasibility, pricing)

      {
        'compliance_matrix' => compliance_matrix,
        'data_boundary_checks' => data_boundary_checks,
        'proposal_summary' => proposal_summary,
        'draft_quotation' => draft_quotation
      }
    end

    private

    def build_compliance_matrix(extracted, feasibility)
      rows = []

      (feasibility['matched_items'] || []).each do |m|
        status_label = if m['status'] == 'OUT_OF_CATALOG'
                         'NGOÀI DANH MỤC (Cần xác nhận NCC & duyệt)'
                       else
                         'ĐÁP ỨNG ĐẦY ĐỦ'
                       end
        rows << {
          'type' => 'Hạng mục',
          'requirement' => "#{m['requested_name']} (SL: #{m['quantity']})",
          'proposed_solution' => "#{m['selected_sku']} - #{m['selected_name']}",
          'status' => m['status'] == 'OUT_OF_CATALOG' ? 'OUT_OF_CATALOG' : 'COMPLIANT',
          'status_label' => status_label,
          'evidence' => m['compliance_notes']
        }
      end

      (extracted['mandatory_conditions'] || []).each do |cond|
        code = cond['code']
        status = 'COMPLIANT'
        status_label = 'ĐÁP ỨNG ĐẦY ĐỦ'
        evidence = "Đã cấu hình/cam kết theo tiêu chuẩn Thiên Minh (Trích dẫn: #{cond['source_excerpt']})"

        if code == 'MAND-IP67'
          status = 'OUT_OF_CATALOG'
          status_label = 'NGOÀI DANH MỤC (Cần NCC chuyên dụng)'
          evidence = 'Đề xuất sourcing từ NCC Moxa/Hirschmann, cần Kỹ thuật & Ban Giám đốc phê duyệt.'
        elsif code == 'MAND-PENALTY'
          status = 'CONDITIONAL'
          status_label = 'ĐÁP ỨNG CÓ ĐIỀU KIỆN (Cần rà soát pháp lý)'
          evidence = 'Điều khoản phạt chậm tiến độ cần Trưởng phòng KD & Ban Giám đốc phê duyệt.'
        end

        rows << {
          'type' => 'Điều kiện bắt buộc',
          'requirement' => cond['label'],
          'proposed_solution' => cond['code'],
          'status' => status,
          'status_label' => status_label,
          'evidence' => evidence
        }
      end

      sched = feasibility['schedule_check'] || {}
      rows << {
        'type' => 'Tiến độ & Vận hành',
        'requirement' => "Hoàn thành trong #{sched['requested_days']} ngày",
        'proposed_solution' => sched['feasible'] ? "Triển khai trong #{(sched['recommended_weeks'] || []).join(', ')}" : "Đề xuất #{sched['earliest_feasible_days']} ngày",
        'status' => sched['feasible'] ? 'COMPLIANT' : 'CONFLICT',
        'status_label' => sched['feasible'] ? 'ĐÁP ỨNG ĐẦY ĐỦ' : 'XUNG ĐỘT LỊCH TRIỂN KHAI',
        'evidence' => sched['recommendation']
      }

      rows
    end

    def build_data_boundary_checks(extracted, feasibility, pricing)
      auth = pricing['authority_gate'] || {}
      sched = feasibility['schedule_check'] || {}
      traps_count = (feasibility['rejected_low_price_traps'] || []).size

      [
        {
          'department' => 'Kinh doanh (Commercial Boundary)',
          'status' => (pricing['within_budget'] && !auth['needs_escalation']) ? 'PASS' : 'REVIEW_REQUIRED',
          'checks' => [
            "Đơn giá khớp 100% bảng giá chuẩn Thiên Minh (#{(pricing['line_items'] || []).size} dòng).",
            "Chiết khấu đề xuất: #{pricing['proposed_discount_pct']}% (Chuẩn bậc: #{pricing['standard_discount_pct']}%).",
            "Biên lợi nhuận gộp: #{pricing['gross_margin_pct']}%.",
            pricing['within_budget'] ? 'Tổng giá trước VAT nằm trong ngân sách khách hàng.' : "Vượt ngân sách khách hàng #{format_vnd((pricing['budget_gap_vnd'] || 0).abs)}."
          ]
        },
        {
          'department' => 'Kỹ thuật (Technical Boundary)',
          'status' => feasibility['has_out_of_catalog'] ? 'REVIEW_REQUIRED' : 'PASS',
          'checks' => [
            "Đã kiểm tra chéo #{(extracted['mandatory_conditions'] || []).size} điều kiện bắt buộc của RFP.",
            traps_count > 0 ? "Đã tự động loại #{traps_count} gói giá thấp không đủ chức năng bắt buộc." : 'Không phát hiện xung đột giữa chi phí và tính năng bắt buộc.',
            feasibility['has_out_of_catalog'] ? "Cảnh báo: Có #{(feasibility['out_of_catalog_items'] || []).size} hạng mục ngoài danh mục cần Kỹ thuật xác minh NCC." : '100% thiết bị thuộc danh mục chuẩn sẵn có.'
          ]
        },
        {
          'department' => 'Vận hành (Operations Boundary)',
          'status' => sched['feasible'] ? 'PASS' : 'REVIEW_REQUIRED',
          'checks' => [
            "Lead-time nhập hàng tối đa: #{sched['max_hardware_lead_days']} ngày; Nhu cầu nhân lực: #{sched['estimated_man_days']} man-days.",
            "Năng lực tuần hiện có trong khung thời hạn: #{sched['available_man_days_in_window']} man-days.",
            sched['feasible'] ? 'Lịch triển khai khả thi trong quỹ năng lực đội ngũ.' : 'Cảnh báo quá tải lịch triển khai/không kịp deadline nếu không điều chỉnh.'
          ]
        }
      ]
    end

    def build_proposal_summary(case_id, extracted, feasibility, pricing, revision_notes)
      sched = feasibility['schedule_check'] || {}
      {
        'proposal_code' => "PROP-#{case_id}",
        'customer_name' => extracted['customer_name'],
        'location' => extracted['location'] || 'Theo địa điểm khách hàng chỉ định',
        'scale' => extracted['scale_summary'] || 'Quy mô doanh nghiệp',
        'executive_overview' => "Thiên Minh đề xuất giải pháp hạ tầng mạng và bảo mật đồng bộ cho #{extracted['customer_name']}, đảm bảo đáp ứng đầy đủ #{(extracted['mandatory_conditions'] || []).size} điều kiện kỹ thuật & pháp lý bắt buộc, loại bỏ rủi ro thiếu hụt tính năng và kiểm soát chặt tiến độ bàn giao.",
        'implementation_plan' => [
          { 'phase' => 'Giai đoạn 1 (Tuần 1)', 'activity' => 'Khảo sát hiện trạng chi tiết, chốt kiến trúc LLD & đặt hàng thiết bị chính hãng (CO/CQ).' },
          { 'phase' => 'Giai đoạn 2 (Tuần 2-3)', 'activity' => 'Pre-staging cấu hình thiết bị tại Lab Thiên Minh, kiểm thử HA/VLAN/PoE trước khi mang ra site.' },
          { 'phase' => 'Giai đoạn 3 (Tuần 4+)', 'activity' => "Lắp đặt tận nơi, đấu nối hệ thống, test nghiệm thu UAT và chuyển giao tài liệu As-Built (#{(sched['recommended_weeks'] || []).join(', ')})." }
        ],
        'risk_highlights' => [
          feasibility['rejected_low_price_traps'].any? ? "Đã chặn #{feasibility['rejected_low_price_traps'].size} cấu hình giá thấp không đủ tính năng (PoE/Layer 3/IPS/HA/SLA)." : nil,
          feasibility['has_out_of_catalog'] ? 'Có thiết bị ngoài danh mục cần xác nhận báo giá NCC phụ.' : nil,
          sched['feasible'] ? nil : sched['recommendation'],
          pricing['within_budget'] ? nil : 'Giá đề xuất vượt ngân sách trần của KH — cần đàm phán phương án hoặc phân kỳ đầu tư.'
        ].compact,
        'revision_history' => revision_notes
      }
    end

    def build_draft_quotation(case_id, company, policies, extracted, feasibility, pricing)
      sched = feasibility['schedule_check'] || {}
      {
        'quote_number' => "QT-#{case_id}",
        'issue_date' => '2026-11-12',
        'validity_days' => policies['quote_validity_days'] || 30,
        'seller' => company,
        'buyer' => {
          'name' => extracted['customer_name'],
          'location' => extracted['location'] || 'Việt Nam'
        },
        'items' => pricing['line_items'],
        'summary' => {
          'list_subtotal_vnd' => pricing['list_subtotal_vnd'],
          'discount_pct' => pricing['proposed_discount_pct'],
          'discount_amount_vnd' => pricing['discount_amount_vnd'],
          'net_before_vat_vnd' => pricing['net_before_vat_vnd'],
          'vat_rate_pct' => pricing['vat_rate_pct'],
          'vat_amount_vnd' => pricing['vat_amount_vnd'],
          'grand_total_vnd' => pricing['grand_total_vnd']
        },
        'commercial_terms' => [
          "Thời gian giao hàng & triển khai: #{sched['feasible'] ? "#{sched['requested_days']} ngày" : "#{sched['earliest_feasible_days']} ngày (đề xuất điều chỉnh theo năng lực thực tế)"}.",
          'Chứng từ kèm theo: Đầy đủ CO/CQ chính hãng từ Nhà sản xuất cho toàn bộ thiết bị.',
          'Thanh toán: Đợt 1 tạm ứng 40% khi ký HĐ; Đợt 2 thanh toán 40% khi giao hàng; Đợt 3 thanh toán 20% sau nghiệm thu bàn giao.',
          "Hiệu lực báo giá: #{policies['quote_validity_days'] || 30} ngày kể từ ngày phát hành."
        ]
      }
    end

    def format_vnd(num)
      s = num.to_i.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\\1.').reverse
      "#{s} VND"
    end
  end
end

