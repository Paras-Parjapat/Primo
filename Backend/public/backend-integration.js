/* LUMIÈRE production API bridge. Keeps the existing UI/design and moves persistent data to Express + Neon. */
(() => {
  const API_BASE = '';
  const originalNormalize = window.normalizeProduct;

  function normalizeProduct(p){
    const base = originalNormalize ? originalNormalize(p) : p;
    return {
      ...base,
      id: Number(p.id),
      name: p.name || 'Untitled Product',
      cat: p.cat || p.category || 'Basics',
      price: Number(p.price) || 0,
      img: p.img || p.image_url || '',
      desc: p.desc || p.description || '',
      sizes: Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['S','M','L','XL'],
      colors: Array.isArray(p.colors) ? p.colors.map(c => ({
        n: c.n || 'Color', h: c.h || '#ffffff',
        photos: Array.isArray(c.photos) ? c.photos.filter(Boolean).slice(0,3) : []
      })) : []
    };
  }

  async function api(path, options={}){
    const opts = { credentials:'include', ...options, headers:{ ...(options.headers||{}) } };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type']='application/json';
      opts.body=JSON.stringify(opts.body);
    }
    const r = await fetch(API_BASE + path, opts);
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  async function loadProductsFromServer(showError=true){
    try {
      const list = await api('/api/products');
      if(Array.isArray(list) && list.length){
        PRODUCTS = list.map(normalizeProduct);
        PRODUCTS.forEach(normalizeProductImages);
        buildShowcase();
        renderProducts(document.querySelector('.filter-btn.active')?.dataset.cat || 'all');
      }
      return PRODUCTS;
    } catch(e){
      if(showError) toast('Could not connect to store database');
      return PRODUCTS;
    }
  }

  window.adminLogin = async function(){
    const password = $('adminPass').value;
    if(!password){ toast('Enter your admin password'); return; }
    try{
      await api('/api/admin/login',{method:'POST',body:{password}});
      $('adminPass').value='';
      closeModal('adminLoginModal');
      await renderAdmin();
      openModal('adminPanelModal');
    }catch(e){ toast(e.message || 'Incorrect password'); }
  };

  window.confirmPayment = async function(){
    if(!pendingCheckout || !cart.length){ toast('Your checkout session expired'); return; }
    try{
      const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
      const order = await api('/api/orders',{method:'POST',body:{customer:pendingCheckout,items:cart,total}});
      cart=[]; saveCart(); updateBagCount();
      $('successOrderId').textContent=order.id;
      ['cName','cAcc','cPhone','cAddr'].forEach(id=>$(id).value='');
      pendingCheckout=null;
      closeModal('paymentModal');
      openModal('successModal');
    }catch(e){ toast(e.message || 'Could not submit order'); }
  };

  window.loadOrderHistory = async function(){
    const phone=$('historyPhone').value.replace(/\D/g,'');
    const res=$('historyResult');
    if(!/^[6-9]\d{9}$/.test(phone)){ toast('Enter a valid 10-digit phone number'); return; }
    const query=String($('historySearch')?.value||'').trim().toUpperCase();
    res.innerHTML='<div class="empty-state">Loading your orders…</div>';
    try{
      const orders=await api('/api/orders/history?phone='+encodeURIComponent(phone)+'&search='+encodeURIComponent(query));
      if(!orders.length){
        res.innerHTML='<div class="empty-state" style="background:var(--bg-2);padding:1.5rem;border-radius:10px;border:1px solid var(--line)">No previous orders found for this phone number.</div>';
        return;
      }
      res.innerHTML=`<div class="history-list">${orders.map(o=>`
        <div class="history-card">
          <div class="history-card-head"><span class="order-id">${o.id}</span><span class="status ${o.status}">${o.status}</span></div>
          <div class="history-meta"><div><strong>Order date:</strong> ${new Date(o.date).toLocaleString('en-IN')}</div><div><strong>Total:</strong> ${fmt(o.total)}</div></div>
          <div class="history-items">${o.items.map(i=>`<div class="history-item"><div><div class="pid">Product ID: ${i.productId ?? i.id}</div><div class="pname">${i.name}</div><div class="history-meta">Size ${i.size} • ${i.color} • Qty ${i.qty}</div></div><strong>${fmt(i.price*i.qty)}</strong></div>`).join('')}</div>
          <div class="order-actions"><button class="btn-sm btn-edit" onclick="trackFromHistory('${o.id}')">Check Status</button></div>
        </div>`).join('')}</div>`;
    }catch(e){ res.innerHTML='<div class="empty-state">Could not load order history.</div>'; toast(e.message); }
  };

  window.trackOrder = async function(){
    const id=$('trackInput').value.trim().toUpperCase();
    const res=$('trackResult');
    if(!id){ toast('Enter an Order ID'); return; }
    try{
      const o=await api('/api/orders/'+encodeURIComponent(id));
      res.innerHTML=`<div class="order-row"><div class="order-row-head"><span class="order-id">${o.id}</span><span class="status ${o.status}">${o.status}</span></div><div class="order-details"><div><strong>Customer:</strong> ${o.customer.name}</div><div><strong>Phone:</strong> ${o.customer.phone}</div><div><strong>Address:</strong> ${o.customer.addr}</div><div><strong>Items:</strong> ${o.items.map(i=>`Product ID ${i.productId ?? i.id} — ${i.name} (${i.size}/${i.color}) ×${i.qty}`).join(', ')}</div><div><strong>Total:</strong> ${fmt(o.total)}</div><div><strong>Date:</strong> ${new Date(o.date).toLocaleString('en-IN')}</div></div></div>`;
    }catch(e){ res.innerHTML=`<div class="empty-state" style="background:var(--bg-2);padding:1.5rem;border-radius:10px;border:1px solid var(--burgundy)">${e.message || 'No order found'}</div>`; }
  };

  async function fetchAdminOrders(){ return api('/api/admin/orders'); }

  window.renderAdmin = async function(){
    try{
      const adminOrders=await fetchAdminOrders();
      $('adminOrders').innerHTML = adminOrders.length===0 ? '<div class="empty-state">No orders yet.</div>' : adminOrders.map(o=>`
        <div class="order-row"><div class="order-row-head"><span class="order-id">${o.id}</span><span class="status ${o.status}">${o.status}</span></div><div class="order-details"><div><strong>Name:</strong> ${o.customer.name} • <strong>UPI Acc:</strong> ${o.customer.acc}</div><div><strong>Phone:</strong> ${o.customer.phone}</div><div><strong>Address:</strong> ${o.customer.addr}</div><div><strong>Items:</strong> ${o.items.map(i=>`Product ID ${i.productId ?? i.id} — ${i.name} (${i.size}/${i.color}) ×${i.qty}`).join(', ')}</div><div><strong>Total:</strong> ${fmt(o.total)} • <strong>Date:</strong> ${new Date(o.date).toLocaleString('en-IN')}</div></div><div class="order-actions">${o.status==='pending'?`<button class="btn-sm btn-approve" onclick="updateOrderStatus('${o.id}','approved')">Approve</button><button class="btn-sm btn-reject" onclick="updateOrderStatus('${o.id}','rejected')">Reject</button>`:`<button class="btn-sm" style="border-color:var(--line);color:var(--ivory-dim)" onclick="updateOrderStatus('${o.id}','pending')">Reset to Pending</button>`}<button class="btn-sm btn-reject" onclick="deleteOrder('${o.id}')">Delete</button></div></div>`).join('');
      await loadProductsFromServer(false);
      renderAdminProducts();
    }catch(e){ toast('Admin session expired or unavailable'); closeModal('adminPanelModal'); openModal('adminLoginModal'); }
  };

  window.updateOrderStatus = async function(id,status){
    try{ await api('/api/admin/orders/'+encodeURIComponent(id)+'/status',{method:'PATCH',body:{status}}); await renderAdmin(); toast('Order '+status); }
    catch(e){ toast(e.message); }
  };
  window.deleteOrder = async function(id){
    if(!confirm('Delete this order?')) return;
    try{ await api('/api/admin/orders/'+encodeURIComponent(id),{method:'DELETE'}); await renderAdmin(); toast('Order deleted'); }
    catch(e){ toast(e.message); }
  };

  window.saveProductFromEditor = async function(){
    const id=Number($('peId').value), name=$('peName').value.trim(), cat=$('peCat').value, price=Number($('pePrice').value), desc=$('peDesc').value.trim(), sizes=$('peSizes').value.split(',').map(x=>x.trim()).filter(Boolean);
    if(!id || !name || !cat || price<0 || !desc || !sizes.length){ toast('Fill all product information'); return; }
    const existing=PRODUCTS.find(p=>p.id===editingProductId);
    if(addingNewProduct && PRODUCTS.some(p=>p.id===id)){ toast('Product ID already exists'); return; }
    const colors=[];
    try{
      for(const el of document.querySelectorAll('#peColors .color-editor')){
        const n=el.querySelector('.pe-color-name').value.trim(); const h=el.querySelector('.pe-color-hex').value.trim() || '#ffffff';
        if(!n){ toast('Every color needs a name'); return; }
        const old=[...el.querySelectorAll('[data-existing-photo]')].map(x=>decodeURIComponent(x.getAttribute('data-existing-photo'))).filter(Boolean);
        const files=[...el.querySelectorAll('.pe-color-photo')].map(x=>x.files[0]||null);
        const photos=[]; for(let j=0;j<3;j++) photos.push((await readFileAsDataURL(files[j])) || old[j] || null);
        colors.push({n,h,photos:photos.filter(Boolean).slice(0,3)});
      }
    }catch(e){ toast('Could not read product photos'); return; }
    if(!colors.length){ toast('Add at least one color'); return; }
    const product={id,name,cat,price,desc,sizes,colors,img:colors[0].photos[0] || existing?.img || ''};
    try{
      const saved=await api(addingNewProduct?'/api/admin/products':'/api/admin/products/'+id,{method:addingNewProduct?'POST':'PUT',body:product});
      const mapped=normalizeProduct(saved);
      const idx=PRODUCTS.findIndex(p=>p.id===mapped.id);
      if(idx>=0) PRODUCTS[idx]=mapped; else PRODUCTS.push(mapped);
      PRODUCTS.forEach(normalizeProductImages); editingProductId=null; addingNewProduct=false;
      buildShowcase(); renderProducts(document.querySelector('.filter-btn.active')?.dataset.cat||'all'); renderAdminProducts(); toast(addingNewProduct?'Product added':'Product updated');
    }catch(e){ toast(e.message || 'Could not save product'); }
  };

  window.deleteProduct = async function(id){
    if(!confirm('Delete this product?')) return;
    try{ await api('/api/admin/products/'+id,{method:'DELETE'}); PRODUCTS=PRODUCTS.filter(p=>p.id!==id); buildShowcase(); renderProducts(document.querySelector('.filter-btn.active')?.dataset.cat||'all'); renderAdminProducts(); toast('Product deleted'); }
    catch(e){ toast(e.message); }
  };

  window.productEditorTemplate = function(p=null){
    if(p){ editingProductId=p.id; addingNewProduct=false; }
    else { editingProductId=null; }
    const colors=p?.colors?.length ? p.colors : [{n:'Ivory',h:'#f5ecd7',photos:p?.img?[p.img]:[]}];
    return `<div class="product-editor"><div class="order-row-head" style="margin-bottom:1rem"><div><span class="order-id">${p?'Edit Product':'Add New Product'}</span>${p?` <span class="product-id-pill">Product ID ${p.id}</span>`:''}</div><button class="btn-sm" style="border-color:var(--line);color:var(--ivory-dim)" onclick="cancelProductEdit()">Close</button></div><div class="product-editor-grid"><div class="form-group"><label>Product ID</label><input id="peId" type="number" min="1" value="${p?.id??''}" ${p?'readonly':''} placeholder="Unique numeric ID"></div><div class="form-group"><label>Product Name</label><input id="peName" value="${(p?.name||'').replace(/"/g,'&quot;')}" placeholder="Product name"></div><div class="form-group"><label>Category</label><select id="peCat"><option ${p?.cat==='Basics'?'selected':''}>Basics</option><option ${p?.cat==='Outwear'?'selected':''}>Outwear</option><option ${p?.cat==='Knitwear'?'selected':''}>Knitwear</option><option ${p?.cat==='Denim'?'selected':''}>Denim</option><option ${p?.cat==='Tailoring'?'selected':''}>Tailoring</option></select></div><div class="form-group"><label>Price (₹)</label><input id="pePrice" type="number" min="0" value="${p?.price??''}" placeholder="24999"></div><div class="form-group full"><label>Description</label><textarea id="peDesc" placeholder="Product description">${p?.desc??''}</textarea></div><div class="form-group full"><label>Sizes</label><input id="peSizes" value="${(p?.sizes||[]).join(', ')}" placeholder="S, M, L, XL"></div></div><div class="form-group" style="margin-top:.8rem"><label>Colors + Up to 3 Photos Per Color</label><div id="peColors">${colors.map((c,i)=>colorEditor(c,i)).join('')}</div></div><div class="order-actions" style="margin-top:.8rem"><button class="btn-sm btn-edit" onclick="addColorEditor()">+ Add Color</button><button class="btn-royal" style="padding:.65rem 1.2rem" onclick="saveProductFromEditor()">${p?'Save Product':'Add Product'}</button></div></div>`;
  };

  async function bootBackend(){
    await loadProductsFromServer(false);
    try { await api('/api/admin/me'); } catch (_) {}
  }

  // Remove the old frontend-only password literal from the running state as well.
  window.ADMIN_PASS = null;
  bootBackend();
})();
