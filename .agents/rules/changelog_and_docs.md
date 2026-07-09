# Changelog və Sənədlərin Yenilənməsi Qaydası

Antigravity Agenti olaraq, hər dəfə GitHub-a kod göndərmək (push) istəyəndə, push əməliyyatından ƏVVƏL mütləq şəkildə aşağıdakıları etməlisən:

1. **`MasterDeploy-rust/static/changelog.json` faylını yeniləmək:**
   Hazırda üzərində işləyib bitirdiyin yenilikləri və fix-ləri bu JSON faylına yeni bir obyekt olaraq əlavə et. Obyektin `version` sahəsinə Cargo.toml-da olacaq yeni versiyanı yaz (yəni əvvəlki versiyanın 1 pillə artırılmış halını), `changes` sahəsinə isə bu versiyada nələr edildiyini kütləvi anlaşılan dildə, qısa punktlarla Azərbaycan dilində qeyd et. Ən yeni versiya array-in ən başında (index 0) olmalıdır.

2. **`MasterDeploy-rust/static/docs.json` faylını yeniləmək:**
   Əgər layihənin arxitekturasında, server qurulumu və ya istifadə qaydalarında hər hansı bir dəyişiklik etmisənsə, bunu `docs.json` faylındakı müvafiq bölmələrə əlavə edərək faylı yenilə. Əgər dəyişiklik yoxdursa, bu fayla toxunmaya bilərsən.

**CRITICAL INSTRUCTION:** Bütün bu sənədləşmə yeniləmələrini etmədən əsla `gite_gonder_yeni.py` skriptini işə salma və ya GitHub-a kod push etmə. İstifadəçi bu məlumatları "Kömək" və "Yeniləmə" pəncərələrində görəcək, odur ki, mətnləri sistemli və düzgün formada yaz.
